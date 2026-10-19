/**
 * 评分坐标的唯一目录。
 *
 * 维度 key、层级、默认评分权重、i18n 路径只在这里定义；中文/英文文案只存在于
 * `messages/{zh,en}.json`。任何地方想知道「有哪些维度」「这个维度属于哪一层」，
 * 都必须问这里——两套坐标会让画像断链。
 */
import type { DimensionConfig, DimensionLayer, PrimaryStack, RoleFamilyKey } from './types';
import {
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_MIN,
  QUESTION_COUNT_PER_DIMENSION_MAX,
} from './types';

export interface DimensionDefinition {
  key: string;
  layer: DimensionLayer;
  /** 默认评分权重。通用层为 1，族层为 2。 */
  weight: number;
}

/** 通用层 4 维：每场必测，跨岗位族可比。 */
export const GENERAL_DIMENSIONS: DimensionDefinition[] = [
  { key: 'general_communication', layer: 'general', weight: 1 },
  { key: 'general_logic', layer: 'general', weight: 1 },
  { key: 'general_stress', layer: 'general', weight: 1 },
  { key: 'general_learning', layer: 'general', weight: 1 },
];

const FAMILY_DIMENSION_DEFINITIONS: Record<RoleFamilyKey, DimensionDefinition[]> = {
  backend: [
    { key: 'middleware_database', layer: 'family', weight: 2 },
    { key: 'project_deep_dive', layer: 'family', weight: 2 },
    { key: 'system_scenario', layer: 'family', weight: 2 },
    { key: 'backend_fundamentals', layer: 'family', weight: 2 },
  ],
  frontend: [
    { key: 'frontend_fundamentals', layer: 'family', weight: 2 },
    { key: 'browser_network', layer: 'family', weight: 2 },
    { key: 'engineering_practice', layer: 'family', weight: 2 },
    { key: 'project_deep_dive', layer: 'family', weight: 2 },
  ],
  data_algo: [
    { key: 'data_processing', layer: 'family', weight: 2 },
    { key: 'algorithm_complexity', layer: 'family', weight: 2 },
    { key: 'metrics_experiment', layer: 'family', weight: 2 },
    { key: 'project_deep_dive', layer: 'family', weight: 2 },
  ],
  qa_infra: [
    { key: 'testing_strategy', layer: 'family', weight: 2 },
    { key: 'cicd_delivery', layer: 'family', weight: 2 },
    { key: 'observability_incident', layer: 'family', weight: 2 },
    { key: 'project_deep_dive', layer: 'family', weight: 2 },
  ],
  // 「其他」不是失败态：保留通用层，并补「岗位专业能力 + 项目深挖」两个族层维度。
  // 没有它们，产品/运营/AI 应用等无法归入四个技术族的岗位只能出通用行为题；
  // 两个维度也能把题数摊开，避免 10 题里 6 题挤在同一个维度上。
  other: [
    { key: 'role_professional', layer: 'family', weight: 2 },
    { key: 'project_deep_dive', layer: 'family', weight: 2 },
  ],
};

const GO_DIMENSION: DimensionDefinition = { key: 'go_fundamentals', layer: 'family', weight: 2 };

/**
 * 族层维度。后端的语言基础随 `primaryStack` 替换：Go 岗考 Go 基础，
 * 其它栈考通用后端基础——非 Go 堆栈不得生成 Go 类题。
 */
export function familyDimensions(
  roleFamily: RoleFamilyKey,
  primaryStack: PrimaryStack = 'none',
): DimensionDefinition[] {
  const base = FAMILY_DIMENSION_DEFINITIONS[roleFamily] ?? [];
  if (roleFamily !== 'backend') return base.map((d) => ({ ...d }));

  const foundation = primaryStack === 'go' ? GO_DIMENSION : { key: 'backend_fundamentals', layer: 'family' as const, weight: 2 };
  return [
    ...base.filter((d) => d.key !== 'backend_fundamentals').map((d) => ({ ...d })),
    { ...foundation },
  ];
}

/** 一场面试的完整坐标：通用层 + 族层。 */
export function resolveDimensions(
  roleFamily: RoleFamilyKey,
  primaryStack: PrimaryStack = 'none',
): DimensionDefinition[] {
  return [...GENERAL_DIMENSIONS, ...familyDimensions(roleFamily, primaryStack)].map((d) => ({ ...d }));
}

const ALL_DEFINITIONS: DimensionDefinition[] = [
  ...GENERAL_DIMENSIONS,
  ...Object.values(FAMILY_DIMENSION_DEFINITIONS).flat(),
  GO_DIMENSION,
];

const DEFINITION_BY_KEY = new Map(ALL_DEFINITIONS.map((d) => [d.key, d]));

export function isKnownDimensionKey(key: string): boolean {
  return DEFINITION_BY_KEY.has(key);
}

export function dimensionDefinition(key: string): DimensionDefinition | undefined {
  return DEFINITION_BY_KEY.get(key);
}

/** 把目录条目补上展示文案，得到可进 prompt / 报告的 DimensionConfig。 */
export function toDimensionConfigs(
  definitions: DimensionDefinition[],
  labelOf: (key: string) => string,
  describeOf?: (key: string) => string,
): DimensionConfig[] {
  return definitions.map((definition) => {
    const description = describeOf?.(definition.key);
    return {
      key: definition.key,
      label: labelOf(definition.key),
      layer: definition.layer,
      weight: definition.weight,
      custom: false,
      ...(description ? { description } : {}),
    };
  });
}

/**
 * 出题时用的维度指引：直接取该维度的 description。
 *
 * 文案只有一份，在 `messages/{zh,en}.json`；这里不再放英文兜底表——旧表用的 key
 * 与目录对不上，导致 `resolveDimensionGuide` 永远返回空串。
 */
export function resolveDimensionGuide(dimension: DimensionConfig): string {
  return dimension.description?.trim() ?? '';
}

// ── 题数分配 ─────────────────────────────────────────────────────────────────

/**
 * 把 total 道题按权重分到一组维度上，允许某维度拿 0 题（不强制每维≥1）。
 * 余数按小数部分从大到小分配，并列按原顺序，保证各值之和精确等于 total。
 */
export function allocateByWeight(weights: number[], total: number): number[] {
  const count = weights.length;
  const safeTotal = Math.max(0, Math.floor(total));
  if (count === 0) return [];

  const safeWeights = weights.map((w) => Math.max(w, 0));
  const weightSum = safeWeights.reduce((sum, w) => sum + w, 0);
  const effective = weightSum > 0 ? safeWeights : safeWeights.map(() => 1);
  const effectiveSum = effective.reduce((sum, w) => sum + w, 0);

  const exact = effective.map((w) => (w / effectiveSum) * safeTotal);
  const floors = exact.map(Math.floor);
  let assigned = floors.reduce((sum, n) => sum + n, 0);
  const fractions = exact
    .map((n, index) => ({ index, fraction: n - Math.floor(n) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  let cursor = 0;
  while (assigned < safeTotal) {
    floors[fractions[cursor % fractions.length].index] += 1;
    assigned += 1;
    cursor += 1;
  }
  return floors;
}

/**
 * 把 total 道题按评分权重分到各维度上。
 *
 * 兼容旧数据：旧配置里 total 就等于各维度 weight 之和，此时权重即题数。
 * 新配置请用 `planQuestionCounts`——它还要保证通用层恒定全覆盖。
 */
export function allocateQuestions(dimensions: DimensionConfig[], total: number): Record<string, number> {
  const configuredTotal = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (configuredTotal === total && dimensions.length > 0) {
    return Object.fromEntries(dimensions.map((dimension) => [dimension.key, dimension.weight]));
  }

  const result: Record<string, number> = {};
  if (dimensions.length === 0) return result;
  const safeTotal = Math.max(0, Math.floor(total));

  const weights = dimensions.map((dimension) => Math.max(dimension.weight, 0));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const effectiveWeights = weightSum > 0 ? weights : dimensions.map(() => 1);

  if (safeTotal <= dimensions.length) {
    for (const dimension of dimensions) result[dimension.key] = 0;
    const ranked = dimensions
      .map((dimension, index) => ({ dimension, index }))
      .sort((a, b) => effectiveWeights[b.index] - effectiveWeights[a.index] || a.index - b.index);
    for (const { dimension } of ranked.slice(0, safeTotal)) result[dimension.key] = 1;
    return result;
  }

  const remainder = safeTotal - dimensions.length;
  const extra = allocateByWeight(effectiveWeights, remainder);
  dimensions.forEach((dimension, index) => {
    result[dimension.key] = 1 + extra[index];
  });
  return result;
}

/**
 * 本场各维度出几道题。
 *
 * 规则：**通用层恒定全覆盖**（每维先占 1 题，跨岗位族可比的前提），剩余题数按
 * 族层评分权重分配；族层为「其他」时，剩余题数回到通用层，总数仍然精确。
 * 拿 0 题的维度在评分时 weight 置 0，不拉低总分。
 */
export function planQuestionCounts(params: {
  general: DimensionConfig[];
  family: DimensionConfig[];
  total: number;
}): Record<string, number> {
  const { general, family } = params;
  const total = Math.max(0, Math.floor(params.total));

  const counts: Record<string, number> = {};
  for (const dimension of [...general, ...family]) counts[dimension.key] = 0;

  let remaining = total;
  const generalCoverage = Math.min(general.length, remaining);
  for (let i = 0; i < generalCoverage; i += 1) {
    counts[general[i].key] = 1;
    remaining -= 1;
  }

  if (remaining > 0) {
    const recipients = family.length > 0 ? family : general;
    if (recipients.length > 0) {
      const extra = allocateByWeight(recipients.map((d) => d.weight), remaining);
      recipients.forEach((dimension, index) => {
        counts[dimension.key] += extra[index];
      });
    }
  }

  return counts;
}

export function totalQuestions(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/**
 * 把单维题数压进滑块上限，并把多出来的题数转给还有空间的维度。
 *
 * `planQuestionCounts` 只保证总数精确，不知道「单维最多 5 题」这条 UI/校验约束：
 * 当用户把族层维度关到只剩一个时，10 题会全部堆到它身上（6 题 > 5），
 * 滑块与 `validateQuestionCounts` 都会失效。这里做一次无损再平衡。
 */
export function capQuestionCountsPerDimension(
  dimensions: DimensionConfig[],
  counts: Record<string, number>,
): Record<string, number> {
  const result = { ...counts };
  let overflow = 0;

  for (const dimension of dimensions) {
    const value = Math.max(0, Math.floor(result[dimension.key] ?? 0));
    if (value > QUESTION_COUNT_PER_DIMENSION_MAX) {
      overflow += value - QUESTION_COUNT_PER_DIMENSION_MAX;
      result[dimension.key] = QUESTION_COUNT_PER_DIMENSION_MAX;
    } else {
      result[dimension.key] = value;
    }
  }

  // 优先补给当前题数最少的维度，避免再次把某一维堆满。
  while (overflow > 0) {
    const target = dimensions
      .filter((dimension) => (result[dimension.key] ?? 0) < QUESTION_COUNT_PER_DIMENSION_MAX)
      .sort((left, right) => (result[left.key] ?? 0) - (result[right.key] ?? 0))[0];
    if (!target) break;
    result[target.key] = (result[target.key] ?? 0) + 1;
    overflow -= 1;
  }

  return result;
}

/**
 * 「其他」族的存量岗位没有 role_professional：题数够时从最大的通用维度借一题，
 * 保证重新出题至少有一道岗位专业题。返回新对象，不修改入参；不满足条件时原样返回。
 */
export function ensureRoleProfessionalCoverage(
  roleFamily: RoleFamilyKey,
  dimensions: DimensionConfig[],
  counts: Record<string, number>,
): Record<string, number> {
  if (roleFamily !== 'other') return counts;
  if ((counts.role_professional ?? 0) > 0) return counts;
  if (totalQuestions(counts) < QUESTION_COUNT_MIN) return counts;

  // 只从通用层借：自定义/族层维度是用户明确配置的专业方向，不该被悄悄削掉。
  const donor = dimensions
    .filter((dimension) => dimension.layer === 'general' && (counts[dimension.key] ?? 0) > 1)
    .sort((left, right) => (counts[right.key] ?? 0) - (counts[left.key] ?? 0))[0];
  if (!donor) return counts;

  return {
    ...counts,
    [donor.key]: counts[donor.key] - 1,
    role_professional: 1,
  };
}

// ── 面试官视角的逐维度题数 ────────────────────

/**
 * 把一份「每维几题」的配置规整成可用的形状。
 *
 * 规则：
 * - 只认配置里存在的维度 key，其余 key 一律丢弃（避免脏 key 混进题数与画像）；
 * - 通用层恒 ≥1 题——两层坐标可比的前提就是每场都测到；
 * - 单维不超过 `QUESTION_COUNT_PER_DIMENSION_MAX`，超出部分转给还有空间的维度；
 * - 总数落在 [QUESTION_COUNT_MIN, QUESTION_COUNT_MAX]，不足时优先补一个没题目的
 *   族层维度，再轮流补通用层。
 */
export function normalizeQuestionCounts(
  dimensions: DimensionConfig[],
  counts: Record<string, number> | null | undefined,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const dimension of dimensions) {
    const raw = counts?.[dimension.key];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    result[dimension.key] = dimension.layer === 'general' ? Math.max(1, value) : value;
  }

  // 先压单维上限；多出来的题数会转给还有空间的维度，总数不丢。
  Object.assign(result, capQuestionCountsPerDimension(dimensions, result));

  let total = totalQuestions(result);

  while (total > QUESTION_COUNT_MAX) {
    const shrinkable = dimensions.filter(
      (dimension) => dimension.layer !== 'general' && (result[dimension.key] ?? 0) > 0,
    );
    if (shrinkable.length === 0) break;
    const target = shrinkable.reduce((max, dimension) =>
      (result[dimension.key] > result[max.key] ? dimension : max));
    result[target.key] -= 1;
    total -= 1;
  }

  // 不足下限时先给还没题目的族层维度各 1 题，再轮流补通用层。
  // 否则「4 个通用维 + 专业维」的岗位会拿到 5 道纯通用题，专业维永远空着。
  const general = dimensions.filter((dimension) => dimension.layer === 'general');
  const unfilledFamily = dimensions.filter(
    (dimension) => dimension.layer !== 'general' && (result[dimension.key] ?? 0) === 0,
  );
  const fillOrder = [...unfilledFamily, ...general];
  let cursor = 0;
  while (total < QUESTION_COUNT_MIN && fillOrder.length > 0) {
    result[fillOrder[cursor % fillOrder.length].key] += 1;
    cursor += 1;
    total += 1;
  }

  return result;
}

/** 逐维度题数的校验错误清单；空数组表示通过。 */
export function validateQuestionCounts(
  dimensions: DimensionConfig[],
  counts: Record<string, number> | null | undefined,
): string[] {
  const errors: string[] = [];
  const known = new Set(dimensions.map((dimension) => dimension.key));

  for (const [key, value] of Object.entries(counts ?? {})) {
    if (!known.has(key)) {
      errors.push(`Unknown dimension in questionCounts: ${key}`);
      continue;
    }
    if (!Number.isInteger(value) || value < 0 || value > QUESTION_COUNT_PER_DIMENSION_MAX) {
      errors.push(
        `Dimension "${key}" question count must be an integer in [0, ${QUESTION_COUNT_PER_DIMENSION_MAX}]; received ${value}.`,
      );
    }
  }

  for (const dimension of dimensions) {
    const value = counts?.[dimension.key] ?? 0;
    if (dimension.layer === 'general' && value < 1) {
      errors.push(`General dimension "${dimension.key}" requires at least 1 question.`);
    }
  }

  const total = totalQuestions(
    Object.fromEntries(dimensions.map((dimension) => [dimension.key, counts?.[dimension.key] ?? 0])),
  );
  if (total < QUESTION_COUNT_MIN || total > QUESTION_COUNT_MAX) {
    errors.push(`Total question count must be in [${QUESTION_COUNT_MIN}, ${QUESTION_COUNT_MAX}]; received ${total}.`);
  }

  return errors;
}

/** 自定义维度必须自带考察重点——没有它，出题 prompt 里这一路就是空的。 */
export function validateJobDimensions(dimensions: DimensionConfig[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();

  for (const dimension of dimensions) {
    if (keys.has(dimension.key)) errors.push(`Duplicate dimension key: ${dimension.key}`);
    keys.add(dimension.key);

    if (!dimension.key.trim()) errors.push('Dimension key must not be empty.');
    if (dimension.custom && !(dimension.description ?? '').trim()) {
      errors.push(`Custom dimension "${dimension.label || dimension.key}" requires a description.`);
    }
  }

  if (dimensions.length === 0) errors.push('At least one dimension is required.');
  return errors;
}

/**
 * 把整场题数按轮次切开，轮次之间最多差 1 题，各值与总数精确相等。
 *
 * 题目在生成之后才存在，所以轮次的 `maxQuestions` 必须先由这个函数定下来，
 * 生成完再按同样的切片把题目分配到轮。
 */
export function splitQuestionCountAcrossRounds(total: number, roundCount: number): number[] {
  const rounds = Math.max(0, Math.floor(roundCount));
  if (rounds === 0) return [];
  const safeTotal = Math.max(0, Math.floor(total));
  const base = Math.floor(safeTotal / rounds);
  const remainder = safeTotal % rounds;
  return Array.from({ length: rounds }, (_, index) => base + (index < remainder ? 1 : 0));
}
