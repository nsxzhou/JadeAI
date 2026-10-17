/**
 * 面试官视角的岗位坐标：岗位族 + 语言栈 + 两层坐标 + 逐维度题数。
 *
 * 两件事拆开：
 * - **评分坐标**来自内核目录（`resolveDimensions`），key/layer/weight 只有一份定义，
 *   文案只在 `messages/{zh,en}.json`；
 * - **题数**走 `questionCounts`，与评分权重无关。
 *
 * 自定义维度保留，但只参与本场评分与报告——key 不在目录里，`buildProfile` 会把它
 * 自动排除在能力画像之外。
 */
import type { DimensionConfig, PrimaryStack, RoleFamilyKey } from '@/lib/interview-core/types';
import { QUESTION_COUNT_MAX, QUESTION_COUNT_MIN } from '@/lib/interview-core/types';
import { resolveDimensions } from '@/lib/interview-core/dimension';
import { normalizePrimaryStack, normalizeRoleFamily } from '@/lib/interview-core/role-family';
import { legacyPerspectiveCoordinates, type PerspectiveCoordinates } from '@/lib/interview-core/perspective-legacy';

export type { PerspectiveCoordinates };

/** 该岗位族 + 语言栈下可选的预置维度 key（通用层在前，族层在后）。 */
export function presetDimensionKeys(
  roleFamilyKey: RoleFamilyKey,
  primaryStack: PrimaryStack,
): string[] {
  return resolveDimensions(roleFamilyKey, primaryStack).map((definition) => definition.key);
}

/**
 * 岗位的完整维度清单：canon 维度（通用层恒在）+ 自定义维度。
 *
 * `previous` 用来保留用户改过的 label 与考察重点——切换岗位族时保留下来的维度
 * 不该被 i18n 文案冲掉。
 */
export function jobDimensions(input: {
  roleFamilyKey: RoleFamilyKey;
  primaryStack: PrimaryStack;
  previous?: DimensionConfig[] | null;
  custom?: DimensionConfig[] | null;
  labelOf: (key: string) => string;
  describeOf: (key: string) => string;
}): DimensionConfig[] {
  const previousByKey = new Map((input.previous ?? []).map((dimension) => [dimension.key, dimension]));

  const canon = resolveDimensions(input.roleFamilyKey, input.primaryStack).map((definition) => {
    const old = previousByKey.get(definition.key);
    const description = old?.description?.trim() ? old.description : input.describeOf(definition.key);
    return {
      key: definition.key,
      label: input.labelOf(definition.key),
      layer: definition.layer,
      weight: definition.weight,
      custom: false,
      ...(description ? { description } : {}),
    } satisfies DimensionConfig;
  });

  const canonKeys = new Set(canon.map((dimension) => dimension.key));
  const custom = (input.custom ?? [...previousByKey.values()])
    .filter((dimension) => dimension.custom && !canonKeys.has(dimension.key))
    .map((dimension) => ({
      key: dimension.key,
      label: dimension.label || dimension.key,
      layer: 'family' as const,
      weight: 2,
      custom: true,
      description: dimension.description ?? '',
    }));

  return [...canon, ...custom];
}

/** `question_counts` 列在 sqlite 是 JSON 对象、在 pg 是 text，读取时统一成对象。 */
export function parseQuestionCounts(raw: unknown): Record<string, number> | null {
  if (!raw) return null;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;

  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === 'number' && Number.isFinite(count)) result[key] = count;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * 读一条岗位行并给出可直接使用的坐标。
 *
 * 老岗位（`roleFamilyKey` / `questionCounts` 为空）走 `legacyPerspectiveCoordinates`
 * 推导——升级后不改库也能继续用，回填只是把它落成显式值。
 */
export function normalizeJobCoordinates(job: {
  title: string;
  jobDescription: string;
  roleFamilyKey?: string | null;
  primaryStack?: string | null;
  questionCounts?: unknown;
  dimensions?: unknown;
  questionCount?: number | null;
}): PerspectiveCoordinates {
  const storedCounts = parseQuestionCounts(job.questionCounts);
  const hasRoleFamily = Boolean(job.roleFamilyKey);

  if (!hasRoleFamily || !storedCounts) {
    return legacyPerspectiveCoordinates({
      title: job.title,
      jobDescription: job.jobDescription,
      dimensions: job.dimensions,
    });
  }

  const roleFamilyKey = normalizeRoleFamily(job.roleFamilyKey);
  const primaryStack = normalizePrimaryStack(job.primaryStack);
  const dimensions = jobDimensions({
    roleFamilyKey,
    primaryStack,
    custom: readCustomDimensions(job.dimensions),
    labelOf: (key) => labelFromStored(job.dimensions, key),
    describeOf: (key) => descriptionFromStored(job.dimensions, key),
  });

  const total = Object.values(storedCounts).reduce((sum, count) => sum + count, 0);
  if (total < QUESTION_COUNT_MIN || total > QUESTION_COUNT_MAX) {
    return legacyPerspectiveCoordinates({
      title: job.title,
      jobDescription: job.jobDescription,
      dimensions: job.dimensions,
    });
  }

  return {
    roleFamilyKey,
    primaryStack,
    dimensions,
    questionCounts: Object.fromEntries(
      dimensions.map((dimension) => [dimension.key, Math.max(0, Math.floor(storedCounts[dimension.key] ?? 0))]),
    ),
  };
}

function storedDimensions(raw: unknown): DimensionConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is DimensionConfig =>
      Boolean(item) && typeof item === 'object' && typeof (item as DimensionConfig).key === 'string',
  );
}

function readCustomDimensions(raw: unknown): DimensionConfig[] {
  return storedDimensions(raw).filter((dimension) => dimension.custom);
}

function labelFromStored(raw: unknown, key: string): string {
  return storedDimensions(raw).find((dimension) => dimension.key === key)?.label ?? key;
}

function descriptionFromStored(raw: unknown, key: string): string {
  return storedDimensions(raw).find((dimension) => dimension.key === key)?.description ?? '';
}
