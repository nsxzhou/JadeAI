import { describe, it, expect } from 'vitest';
import { jobDimensions, normalizeJobCoordinates, parseQuestionCounts, presetDimensionKeys } from './job-coordinates';

const labelOf = (key: string) => `label:${key}`;
const describeOf = (key: string) => `desc:${key}`;

describe('presetDimensionKeys', () => {
  it('通用层在前、族层在后', () => {
    const keys = presetDimensionKeys('backend', 'go');
    expect(keys.slice(0, 4)).toEqual([
      'general_communication',
      'general_logic',
      'general_stress',
      'general_learning',
    ]);
    expect(keys).toContain('go_fundamentals');
    expect(keys).not.toContain('backend_fundamentals');
  });

  it('「其他」岗位族只挂通用层', () => {
    expect(presetDimensionKeys('other', 'none')).toHaveLength(4);
  });
});

describe('jobDimensions', () => {
  it('canon 维度带 i18n 文案，权重来自目录', () => {
    const dimensions = jobDimensions({ roleFamilyKey: 'frontend', primaryStack: 'node', labelOf, describeOf });
    const general = dimensions.filter((dimension) => dimension.layer === 'general');
    const family = dimensions.filter((dimension) => dimension.layer === 'family');
    expect(general).toHaveLength(4);
    expect(general.every((dimension) => dimension.weight === 1)).toBe(true);
    expect(family.map((dimension) => dimension.key)).toEqual([
      'frontend_fundamentals',
      'browser_network',
      'engineering_practice',
      'project_deep_dive',
    ]);
    expect(family.every((dimension) => dimension.weight === 2)).toBe(true);
    expect(dimensions[0].description).toBe('desc:general_communication');
  });

  it('用户改过的考察重点在切换岗位族后保留', () => {
    const previous = jobDimensions({ roleFamilyKey: 'backend', primaryStack: 'go', labelOf, describeOf })
      .map((dimension) => (dimension.key === 'general_stress'
        ? { ...dimension, description: '我自己写的压力题说明' }
        : dimension));

    const next = jobDimensions({
      roleFamilyKey: 'frontend',
      primaryStack: 'node',
      previous,
      labelOf,
      describeOf,
    });

    expect(next.find((dimension) => dimension.key === 'general_stress')?.description)
      .toBe('我自己写的压力题说明');
  });

  it('自定义维度保留且归入族层，权重固定 2', () => {
    const dimensions = jobDimensions({
      roleFamilyKey: 'other',
      primaryStack: 'none',
      custom: [{
        key: '产品 sense',
        label: '产品 sense',
        layer: 'family',
        weight: 5,
        custom: true,
        description: '看怎么判断需求优先级',
      }],
      labelOf,
      describeOf,
    });

    const custom = dimensions.find((dimension) => dimension.key === '产品 sense');
    expect(custom).toMatchObject({ layer: 'family', weight: 2, custom: true });
  });
});

describe('parseQuestionCounts', () => {
  it('接受对象与 JSON 字符串两种形态', () => {
    expect(parseQuestionCounts({ a: 1 })).toEqual({ a: 1 });
    expect(parseQuestionCounts('{"a":2}')).toEqual({ a: 2 });
  });

  it('脏数据一律当没有', () => {
    expect(parseQuestionCounts(null)).toBeNull();
    expect(parseQuestionCounts('not json')).toBeNull();
    expect(parseQuestionCounts('[]')).toBeNull();
    expect(parseQuestionCounts({ a: 'x' })).toBeNull();
  });
});

describe('normalizeJobCoordinates', () => {
  const storedDimensions = [
    {
      key: 'go_fundamentals',
      label: 'Go 基础',
      layer: 'family',
      weight: 2,
      custom: false,
      description: 'Go 说明',
    },
  ];

  it('新岗位直接读显式坐标', () => {
    const coords = normalizeJobCoordinates({
      title: '后端工程师',
      jobDescription: 'Go 服务端',
      roleFamilyKey: 'backend',
      primaryStack: 'go',
      questionCounts: {
        general_communication: 2,
        general_logic: 2,
        general_stress: 2,
        general_learning: 2,
        go_fundamentals: 2,
        middleware_database: 2,
        project_deep_dive: 2,
        system_scenario: 2,
      },
      dimensions: storedDimensions,
    });

    expect(coords.roleFamilyKey).toBe('backend');
    expect(coords.primaryStack).toBe('go');
    expect(coords.questionCounts.go_fundamentals).toBe(2);
    expect(coords.dimensions.find((dimension) => dimension.key === 'go_fundamentals')?.label)
      .toBe('Go 基础');
  });

  it('老岗位（没有岗位族与 questionCounts）走旧坐标推导', () => {
    const coords = normalizeJobCoordinates({
      title: '后端工程师',
      jobDescription: 'Go 服务端',
      dimensions: storedDimensions,
      questionCount: 12,
    });

    expect(coords.roleFamilyKey).toBe('backend');
    expect(coords.primaryStack).toBe('go');
    expect(coords.questionCounts.go_fundamentals).toBe(2);
    expect(Object.values(coords.questionCounts).reduce((sum, n) => sum + n, 0))
      .toBeGreaterThanOrEqual(5);
  });

  it('questionCounts 损坏时回落旧坐标推导，不抛错', () => {
    const coords = normalizeJobCoordinates({
      title: '前端工程师',
      jobDescription: 'React',
      roleFamilyKey: 'frontend',
      primaryStack: 'node',
      questionCounts: { general_communication: 1 },
      dimensions: storedDimensions,
    });

    expect(coords.roleFamilyKey).toBe('backend');
    expect(Object.values(coords.questionCounts).reduce((sum, n) => sum + n, 0))
      .toBeGreaterThanOrEqual(5);
  });
});
