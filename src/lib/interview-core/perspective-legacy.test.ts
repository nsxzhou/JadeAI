import { describe, it, expect } from 'vitest';
import { legacyPerspectiveCoordinates, mapLegacyDimensionKey } from './perspective-legacy';
import { QUESTION_COUNT_MAX, QUESTION_COUNT_MIN } from './types';
import { normalizeQuestionCounts, validateQuestionCounts, type DimensionConfig } from './index';

const legacyDims = (dims: Array<{ key: string; weight: number; label?: string; description?: string; custom?: boolean }>) =>
  dims.map((dim) => ({
    key: dim.key,
    label: dim.label ?? dim.key,
    description: dim.description ?? '',
    weight: dim.weight,
    custom: dim.custom ?? false,
    layer: 'family',
  }));

describe('mapLegacyDimensionKey', () => {
  it('技术维度原样保留', () => {
    for (const key of ['go_fundamentals', 'backend_fundamentals', 'middleware_database', 'project_deep_dive', 'system_scenario']) {
      expect(mapLegacyDimensionKey(key)).toBe(key);
    }
  });

  it('两个没有 canon 对应项的旧维度归并到通用层', () => {
    expect(mapLegacyDimensionKey('communication_pressure')).toBe('general_stress');
    expect(mapLegacyDimensionKey('hr_motivation')).toBe('general_communication');
  });

  it('自定义 key 原样保留', () => {
    expect(mapLegacyDimensionKey('项目难点')).toBe('项目难点');
  });
});

describe('legacyPerspectiveCoordinates', () => {
  it('出现过 go_fundamentals 就判定为后端 + Go 栈', () => {
    const coords = legacyPerspectiveCoordinates({
      title: '高级工程师',
      jobDescription: '负责服务端研发',
      dimensions: legacyDims([
        { key: 'go_fundamentals', weight: 3 },
        { key: 'middleware_database', weight: 2 },
      ]),
    });

    expect(coords.roleFamilyKey).toBe('backend');
    expect(coords.primaryStack).toBe('go');
    expect(coords.dimensions.some((dimension) => dimension.key === 'go_fundamentals')).toBe(true);
    expect(coords.dimensions.some((dimension) => dimension.key === 'backend_fundamentals')).toBe(false);
  });

  it('旧的 weight 变成题数，通用层补齐到每维至少 1 题', () => {
    const coords = legacyPerspectiveCoordinates({
      title: '后端工程师',
      jobDescription: 'Go 服务端',
      dimensions: legacyDims([
        { key: 'go_fundamentals', weight: 2 },
        { key: 'project_deep_dive', weight: 1 },
      ]),
    });

    for (const key of ['general_communication', 'general_logic', 'general_stress', 'general_learning']) {
      expect(coords.questionCounts[key]).toBeGreaterThanOrEqual(1);
    }
    expect(coords.questionCounts.go_fundamentals).toBe(2);
    expect(coords.questionCounts.project_deep_dive).toBe(1);
    const total = Object.values(coords.questionCounts).reduce((sum, count) => sum + count, 0);
    expect(total).toBeGreaterThanOrEqual(QUESTION_COUNT_MIN);
    expect(total).toBeLessThanOrEqual(QUESTION_COUNT_MAX);
  });

  it('映射到同一 key 的题数相加', () => {
    const coords = legacyPerspectiveCoordinates({
      title: '后端工程师',
      jobDescription: '服务端',
      dimensions: legacyDims([
        { key: 'hr_motivation', weight: 2 },
        { key: 'general_communication', weight: 1 },
      ]),
    });

    expect(coords.questionCounts.general_communication).toBe(3);
  });

  it('自定义维度保留为族层维度，并带上原文案', () => {
    const coords = legacyPerspectiveCoordinates({
      title: '产品经理',
      jobDescription: 'B 端产品',
      dimensions: legacyDims([
        { key: '需求判断', weight: 2, label: '需求判断', description: '看怎么取舍', custom: true },
      ]),
    });

    const custom = coords.dimensions.find((dimension) => dimension.key === '需求判断');
    expect(custom).toBeDefined();
    expect(custom?.custom).toBe(true);
    expect(custom?.layer).toBe('family');
    expect(custom?.weight).toBe(2);
    expect(custom?.description).toBe('看怎么取舍');
    expect(coords.questionCounts['需求判断']).toBe(2);
  });

  it('超过上限的总题数被裁剪回上界，通用层不被动', () => {
    const coords = legacyPerspectiveCoordinates({
      title: '后端工程师',
      jobDescription: 'Go 服务端',
      dimensions: legacyDims([
        { key: 'go_fundamentals', weight: 20 },
        { key: 'middleware_database', weight: 20 },
      ]),
    });

    const total = Object.values(coords.questionCounts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(QUESTION_COUNT_MAX);
    expect(coords.questionCounts.general_communication).toBeGreaterThanOrEqual(1);
  });

  it('幂等：同一份输入跑两次结果一致', () => {
    const input = {
      title: '后端工程师',
      jobDescription: 'Go 服务端',
      dimensions: legacyDims([
        { key: 'go_fundamentals', weight: 3 },
        { key: 'hr_motivation', weight: 2 },
      ]),
    };
    expect(legacyPerspectiveCoordinates(input)).toEqual(legacyPerspectiveCoordinates(input));
  });
});

const dim = (overrides: Partial<DimensionConfig>): DimensionConfig => ({
  key: 'general_communication',
  label: '沟通表达',
  layer: 'general',
  weight: 1,
  custom: false,
  ...overrides,
});

describe('normalizeQuestionCounts', () => {
  const dimensions = [
    dim({}),
    dim({ key: 'general_logic', label: '逻辑思维' }),
    dim({ key: 'middleware_database', label: '数据库与中间件', layer: 'family', weight: 2 }),
  ];

  it('通用层抬到至少 1 题，族层允许 0', () => {
    const counts = normalizeQuestionCounts(dimensions, { general_communication: 0, middleware_database: 0 });
    expect(counts.general_communication).toBeGreaterThanOrEqual(1);
    expect(counts.general_logic).toBeGreaterThanOrEqual(1);
    expect(counts.middleware_database).toBe(0);
    // 抬起通用层之后不足下界，继续轮流补到 QUESTION_COUNT_MIN
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(QUESTION_COUNT_MIN);
  });

  it('丢弃配置里不存在的 key', () => {
    const counts = normalizeQuestionCounts(dimensions, { 不存在: 5, general_communication: 2 });
    expect(counts['不存在']).toBeUndefined();
  });

  it('总数不足时轮流补到通用层', () => {
    const counts = normalizeQuestionCounts(dimensions, {
      general_communication: 1,
      general_logic: 1,
    });
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(QUESTION_COUNT_MIN);
  });

  it('总数超限时从族层最大项递减，通用层不动', () => {
    const counts = normalizeQuestionCounts(dimensions, {
      general_communication: 5,
      general_logic: 5,
      middleware_database: 25,
    });
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(QUESTION_COUNT_MAX);
    expect(counts.general_communication).toBe(5);
    expect(counts.middleware_database).toBe(QUESTION_COUNT_MAX - 10);
  });
});

describe('validateQuestionCounts', () => {
  const dimensions = [
    dim({}),
    dim({ key: 'general_logic', label: '逻辑思维' }),
    dim({ key: 'middleware_database', label: '数据库与中间件', layer: 'family', weight: 2 }),
  ];

  it('合法配置没有错误', () => {
    expect(validateQuestionCounts(dimensions, {
      general_communication: 2,
      general_logic: 2,
      middleware_database: 2,
    })).toEqual([]);
  });

  it('总数越界报错', () => {
    expect(validateQuestionCounts(dimensions, {
      general_communication: 1,
      general_logic: 1,
      middleware_database: 0,
    }).join()).toContain('Total question count');
  });

  it('未知 key 与通用层 0 题报错', () => {
    const errors = validateQuestionCounts(dimensions, {
      general_communication: 0,
      general_logic: 4,
      middleware_database: 2,
      幽灵维度: 1,
    });
    expect(errors.join()).toContain('Unknown dimension');
    expect(errors.join()).toContain('requires at least 1 question');
  });
});
