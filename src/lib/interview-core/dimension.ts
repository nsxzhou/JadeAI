/**
 * 评分坐标的唯一目录。
 *
 * 维度 key、层级、默认评分权重、i18n 路径只在这里定义；中文/英文文案只存在于
 * `messages/{zh,en}.json`。任何地方想知道「有哪些维度」「这个维度属于哪一层」，
 * 都必须问这里——两套坐标会让画像断链。
 */
import type { DimensionConfig, DimensionLayer, PrimaryStack, RoleFamilyKey } from './types';

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
  // 「其他」只挂通用层，族层为空。这不是失败态，是兜底。
  other: [],
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
