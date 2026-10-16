import { describe, expect, it } from 'vitest';
import {
  allocateByWeight,
  allocateQuestions,
  planQuestionCounts,
  resolveDimensions,
  splitQuestionCountAcrossRounds,
  toDimensionConfigs,
} from './dimension';
import type { DimensionConfig } from './types';

const dim = (key: string, weight: number, layer: 'general' | 'family' = 'family'): DimensionConfig =>
  ({ key, label: key, layer, weight, custom: false });

describe('allocateByWeight', () => {
  it('分配之和精确等于总数', () => {
    expect(allocateByWeight([1, 1, 1, 1], 11).reduce((a, b) => a + b, 0)).toBe(11);
    expect(allocateByWeight([2, 2, 2, 2], 6)).toEqual([2, 2, 1, 1]);
  });

  it('权重全为 0 时平均分', () => {
    expect(allocateByWeight([0, 0, 0], 3)).toEqual([1, 1, 1]);
  });

  it('允许某维度拿 0 题', () => {
    expect(allocateByWeight([10, 1, 1], 2)).toEqual([2, 0, 0]);
  });
});

describe('allocateQuestions', () => {
  it('total 等于权重和时权重即题数', () => {
    const dims = [dim('a', 3), dim('b', 2), dim('c', 2)];
    expect(allocateQuestions(dims, 7)).toEqual({ a: 3, b: 2, c: 2 });
  });

  it('total 小于维度数时先给权重高的', () => {
    const dims = [dim('a', 3), dim('b', 2), dim('c', 1)];
    expect(allocateQuestions(dims, 2)).toEqual({ a: 1, b: 1, c: 0 });
  });

  it('没有维度时返回空对象', () => {
    expect(allocateQuestions([], 10)).toEqual({});
  });
});

describe('planQuestionCounts', () => {
  const general = [
    dim('general_communication', 1, 'general'),
    dim('general_logic', 1, 'general'),
    dim('general_stress', 1, 'general'),
    dim('general_learning', 1, 'general'),
  ];
  const backendFamily = [
    dim('middleware_database', 2),
    dim('project_deep_dive', 2),
    dim('system_scenario', 2),
    dim('backend_fundamentals', 2),
  ];

  it('通用层恒定全覆盖：每维至少 1 题', () => {
    const counts = planQuestionCounts({ general, family: backendFamily, total: 6 });
    for (const d of general) expect(counts[d.key]).toBeGreaterThanOrEqual(1);
  });

  it('总数精确等于预设题数', () => {
    for (const total of [6, 10, 15]) {
      const counts = planQuestionCounts({ general, family: backendFamily, total });
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('短预设 6 题 = 通用 4 + 族 2', () => {
    const counts = planQuestionCounts({ general, family: backendFamily, total: 6 });
    const familyTotal = backendFamily.reduce((sum, d) => sum + counts[d.key], 0);
    expect(familyTotal).toBe(2);
  });

  it('标准 10 题时后端族层分布精确', () => {
    const counts = planQuestionCounts({ general, family: backendFamily, total: 10 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(10);
    expect(backendFamily.every((d) => counts[d.key] >= 1)).toBe(true);
  });

  it('族层为「其他」时剩余题数回到通用层，总数仍然精确', () => {
    const counts = planQuestionCounts({ general, family: [], total: 10 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(10);
    expect(general.reduce((sum, d) => sum + counts[d.key], 0)).toBe(10);
  });
});

describe('resolveDimensions', () => {
  it('通用层 4 维恒在，族层随岗位族', () => {
    const keys = resolveDimensions('frontend', 'node').map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining([
      'general_communication',
      'general_logic',
      'general_stress',
      'general_learning',
      'frontend_fundamentals',
      'browser_network',
      'engineering_practice',
      'project_deep_dive',
    ]));
  });

  it('Go 栈出现 go_fundamentals，其它栈出现 backend_fundamentals', () => {
    expect(resolveDimensions('backend', 'go').map((d) => d.key)).toContain('go_fundamentals');
    const java = resolveDimensions('backend', 'java').map((d) => d.key);
    expect(java).toContain('backend_fundamentals');
    expect(java).not.toContain('go_fundamentals');
  });

  it('「其他」族只有通用层', () => {
    expect(resolveDimensions('other', 'none').every((d) => d.layer === 'general')).toBe(true);
  });
});

describe('toDimensionConfigs', () => {
  it('用 i18n 填充文案并保留层级权重', () => {
    const configs = toDimensionConfigs(resolveDimensions('other', 'none'), (key) => `label:${key}`);
    expect(configs[0]).toMatchObject({ key: 'general_communication', layer: 'general', weight: 1, custom: false });
    expect(configs[0].label).toBe('label:general_communication');
  });
});

describe('splitQuestionCountAcrossRounds', () => {
  it('各轮之和精确等于总数，轮间最多差 1', () => {
    expect(splitQuestionCountAcrossRounds(6, 2)).toEqual([3, 3]);
    expect(splitQuestionCountAcrossRounds(10, 3)).toEqual([4, 3, 3]);
    expect(splitQuestionCountAcrossRounds(7, 3).reduce((a, b) => a + b, 0)).toBe(7);
    expect(splitQuestionCountAcrossRounds(15, 4)).toEqual([4, 4, 4, 3]);
  });

  it('题数少于轮数时后面的轮次拿 0 题', () => {
    expect(splitQuestionCountAcrossRounds(1, 3)).toEqual([1, 0, 0]);
  });

  it('没有轮次时返回空数组', () => {
    expect(splitQuestionCountAcrossRounds(10, 0)).toEqual([]);
  });
});
