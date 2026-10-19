/**
 * 面试官视角的旧坐标 → 两层坐标的一次性映射。
 *
 * 翻转之前，面试官视角有自己的一套 7 项目录（`go_fundamentals` … `hr_motivation`），
 * 而且 `DimensionConfig.weight` 同时承担「评分权重」与「该维生成几道题」。两层坐标
 * 落地后评分坐标只有内核目录一套，题数走 `questionCounts`。
 *
 * 这里只做纯映射，落库与幂等由 `src/lib/db/backfill-perspective-coordinates.ts` 负责。
 *
 * 两个旧 key 在目录里没有对应项，按「题型保留、评分归并」处理：
 * - `communication_pressure` → `general_stress`（压力场景本身就是抗压）
 * - `hr_motivation` → `general_communication`（动机题评的是表达与自我认知）
 * 题型（`category`）不受影响，仍是这两类题，只是分数落到通用层坐标上。
 */
import type { DimensionConfig, PrimaryStack, RoleFamilyKey } from './types';
import {
  ensureRoleProfessionalCoverage,
  isKnownDimensionKey,
  normalizeQuestionCounts,
  resolveDimensions,
} from './dimension';
import { resolveRoleFamily } from './role-family';

/** 旧目录 key → 两层坐标 key。不在这张表里的 key 原样保留（自定义维度）。 */
export const LEGACY_DIMENSION_MAP: Record<string, string> = {
  go_fundamentals: 'go_fundamentals',
  backend_fundamentals: 'backend_fundamentals',
  middleware_database: 'middleware_database',
  project_deep_dive: 'project_deep_dive',
  system_scenario: 'system_scenario',
  communication_pressure: 'general_stress',
  hr_motivation: 'general_communication',
};

/** 单个旧 key 的归位结果；自定义 key 原样返回。 */
export function mapLegacyDimensionKey(key: string): string {
  return LEGACY_DIMENSION_MAP[key] ?? key;
}

export interface PerspectiveCoordinates {
  roleFamilyKey: RoleFamilyKey;
  primaryStack: PrimaryStack;
  /** canon 维度（沿用旧 label/description）+ 自定义维度 */
  dimensions: DimensionConfig[];
  questionCounts: Record<string, number>;
}

interface LegacyDimensionEntry {
  key: string;
  label: string;
  description: string;
  /** 旧语义：该维度生成几道题 */
  count: number;
  custom: boolean;
}

function readLegacyDimensions(raw: unknown): LegacyDimensionEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): LegacyDimensionEntry | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const key = typeof record.key === 'string' ? record.key.trim() : '';
      if (!key) return null;
      const weight = typeof record.weight === 'number' && Number.isFinite(record.weight)
        ? Math.max(0, Math.floor(record.weight))
        : 0;
      return {
        key,
        label: typeof record.label === 'string' && record.label.trim() ? record.label : key,
        description: typeof record.description === 'string' ? record.description : '',
        count: weight,
        custom: record.custom === true || !isKnownDimensionKey(key),
      };
    })
    .filter((entry): entry is LegacyDimensionEntry => entry !== null);
}

/**
 * 旧岗位（`dimensions` 里 weight 就是题数、没有岗位族与 questionCounts）→ 新坐标。
 *
 * 规则写死在这里，便于测试与回填共用同一份判断：
 * 1. 出现过 `go_fundamentals` 就判定为「后端族 + Go 栈」，否则走静态岗位族判定；
 * 2. 每维题数按映射表累加，映射到同一 key 的相加；
 * 3. 通用层缺失维度各补 1 题，总数裁剪进 [MIN, MAX]；
 * 4. 旧 label/description 原样保留（用户可能改过），`layer`/`weight` 重置为目录口径。
 */
export function legacyPerspectiveCoordinates(input: {
  title: string;
  jobDescription: string;
  dimensions: unknown;
}): PerspectiveCoordinates {
  const entries = readLegacyDimensions(input.dimensions);
  const hasGo = entries.some((entry) => entry.key === 'go_fundamentals');

  const resolved = resolveRoleFamily({
    jobTitle: input.title,
    jobDescription: input.jobDescription,
  });
  const roleFamilyKey: RoleFamilyKey = hasGo ? 'backend' : resolved.roleFamily;
  const primaryStack: PrimaryStack = hasGo ? 'go' : resolved.primaryStack;

  const definitions = resolveDimensions(roleFamilyKey, primaryStack);
  const canonKeys = new Set(definitions.map((definition) => definition.key));

  const labelByKey = new Map<string, { label: string; description: string }>();
  const rawCounts: Record<string, number> = {};
  const customKeys: string[] = [];

  for (const entry of entries) {
    const target = mapLegacyDimensionKey(entry.key);
    rawCounts[target] = (rawCounts[target] ?? 0) + entry.count;
    if (!labelByKey.has(target)) {
      labelByKey.set(target, { label: entry.label, description: entry.description });
    }
    if (!canonKeys.has(target) && !customKeys.includes(target)) customKeys.push(target);
  }

  const dimensions: DimensionConfig[] = definitions.map((definition) => {
    const stored = labelByKey.get(definition.key);
    return {
      key: definition.key,
      label: stored?.label ?? definition.key,
      layer: definition.layer,
      weight: definition.weight,
      custom: false,
      ...(stored?.description ? { description: stored.description } : {}),
    };
  });

  for (const key of customKeys) {
    const stored = labelByKey.get(key);
    dimensions.push({
      key,
      label: stored?.label ?? key,
      layer: 'family',
      weight: 2,
      custom: true,
      description: stored?.description ?? '',
    });
  }

  const questionCounts = ensureRoleProfessionalCoverage(
    roleFamilyKey,
    dimensions,
    normalizeQuestionCounts(dimensions, rawCounts),
  );

  return { roleFamilyKey, primaryStack, dimensions, questionCounts };
}

/** 存量题目行的维度归位；已经是 canon key 的返回原值。 */
export function mapLegacyQuestionDimension(dimension: string): string {
  return mapLegacyDimensionKey(dimension);
}
