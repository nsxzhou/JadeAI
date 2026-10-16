import { describe, expect, it } from 'vitest';
import { clampScoreToTier, computeDimensionScores, computeOverallScore, computeRoundScore, isWeakQuestion, tierOfScore } from './scoring';
import type { DimensionConfig, DimensionScore } from './types';

const dim = (key: string, layer: 'general' | 'family', weight: number): DimensionConfig =>
  ({ key, label: key, layer, weight, custom: false });

describe('clampScoreToTier', () => {
  it('档位边界：59 落 fail、60-84 落 pass、85+ 落 excellent', () => {
    expect(clampScoreToTier('fail', 59)).toBe(59);
    expect(clampScoreToTier('pass', 60)).toBe(60);
    expect(clampScoreToTier('pass', 84)).toBe(84);
    expect(clampScoreToTier('excellent', 85)).toBe(85);
  });

  it('AI 给的分越界时被拉回档位区间', () => {
    expect(clampScoreToTier('fail', 90)).toBe(59);
    expect(clampScoreToTier('excellent', 40)).toBe(85);
    expect(clampScoreToTier('pass', 200)).toBe(84);
    expect(clampScoreToTier('pass', -10)).toBe(60);
  });

  it('非法档位按 pass 处理', () => {
    expect(clampScoreToTier(undefined, 70)).toBe(70);
    expect(clampScoreToTier(null, 70)).toBe(70);
  });

  it('tierOfScore 与 clamp 区间一致', () => {
    expect(tierOfScore(59)).toBe('fail');
    expect(tierOfScore(60)).toBe('pass');
    expect(tierOfScore(84)).toBe('pass');
    expect(tierOfScore(85)).toBe('excellent');
  });
});

describe('computeDimensionScores', () => {
  it('维度分是该维度已评分题目的平均分', () => {
    const scores = computeDimensionScores(
      [dim('general_logic', 'general', 1)],
      [
        { dimension: 'general_logic', score: 80, answer: 'a' },
        { dimension: 'general_logic', score: 70, answer: 'b' },
      ],
    );
    expect(scores[0].score).toBe(75);
    expect(scores[0].weight).toBe(1);
  });

  it('一道题都没答的维度 weight 置 0', () => {
    const scores = computeDimensionScores(
      [dim('general_logic', 'general', 1), dim('project_deep_dive', 'family', 2)],
      [{ dimension: 'general_logic', score: 80, answer: 'a' }],
    );
    expect(scores.find((s) => s.key === 'project_deep_dive')!.weight).toBe(0);
  });

  it('空白回答不计入平均', () => {
    const scores = computeDimensionScores(
      [dim('general_logic', 'general', 1)],
      [
        { dimension: 'general_logic', score: 80, answer: 'a' },
        { dimension: 'general_logic', score: 0, answer: '   ' },
      ],
    );
    expect(scores[0].score).toBe(80);
  });
});

describe('computeOverallScore', () => {
  const score = (key: string, value: number, weight: number): DimensionScore =>
    ({ key, label: key, layer: 'general', score: value, weight });

  it('按权重加权平均并四舍五入', () => {
    // (90*1 + 60*1) / 2 = 75
    expect(computeOverallScore([score('a', 90, 1), score('b', 60, 1)])).toBe(75);
  });

  it('全零返回 0', () => {
    expect(computeOverallScore([score('a', 0, 1), score('b', 0, 1)])).toBe(0);
  });

  it('权重和为 0 时兜底返回 0', () => {
    expect(computeOverallScore([score('a', 90, 0), score('b', 60, 0)])).toBe(0);
  });

  it('weight <= 0 的维度不参与总分', () => {
    // 未作答维度 weight=0，不应把 90 拉低
    expect(computeOverallScore([score('a', 90, 1), score('b', 0, 0)])).toBe(90);
  });
});

describe('computeRoundScore', () => {
  it('没有已评分题目时返回 null', () => {
    expect(computeRoundScore([{ score: null, answer: '' }])).toBeNull();
  });

  it('返回该轮平均分', () => {
    expect(computeRoundScore([{ score: 80, answer: 'a' }, { score: 60, answer: 'b' }])).toBe(70);
  });
});

describe('isWeakQuestion', () => {
  it('阈值边界 59/60/61', () => {
    expect(isWeakQuestion({ score: 59, answer: 'x' })).toBe(true);
    expect(isWeakQuestion({ score: 60, answer: 'x' })).toBe(false);
    expect(isWeakQuestion({ score: 61, answer: 'x' })).toBe(false);
  });

  it('手动标记即入错题本', () => {
    expect(isWeakQuestion({ score: 90, answer: 'x', markedWeak: true })).toBe(true);
  });

  it('空白答案不算已答，也就不入错题本', () => {
    expect(isWeakQuestion({ score: 10, answer: '   ' })).toBe(false);
    expect(isWeakQuestion({ score: 10, answer: '' })).toBe(false);
    expect(isWeakQuestion({ score: 90, markedWeak: true, answer: '' })).toBe(false);
  });
});
