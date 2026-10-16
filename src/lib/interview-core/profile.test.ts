import { describe, expect, it } from 'vitest';
import { buildProfile } from './profile';
import { collectWeakQuestions, planRetryQuestions } from './weak-questions';
import type { DimensionScore, InterviewQuestion, RoleFamilyKey } from './types';

const score = (key: string, layer: 'general' | 'family', value: number): DimensionScore =>
  ({ key, label: key, layer, score: value, weight: layer === 'general' ? 1 : 2 });

describe('buildProfile', () => {
  const session = (id: string, date: string, roleFamilyKey: RoleFamilyKey | null, scores: DimensionScore[]) =>
    ({ sessionId: id, createdAt: date, roleFamilyKey, dimensionScores: scores });

  it('通用层跨场次累积成趋势', () => {
    const profile = buildProfile([
      session('s1', '2026-01-01', 'backend', [score('general_communication', 'general', 60)]),
      session('s2', '2026-02-01', 'frontend', [score('general_communication', 'general', 75)]),
    ]);
    const series = profile.general.find((s) => s.key === 'general_communication')!;
    expect(series.points.map((p) => p.score)).toEqual([60, 75]);
    expect(series.latest).toBe(75);
    expect(series.delta).toBe(15);
  });

  it('族层按岗位族分面，不同族不混在一条线', () => {
    const profile = buildProfile([
      session('s1', '2026-01-01', 'backend', [score('project_deep_dive', 'family', 50)]),
      session('s2', '2026-02-01', 'frontend', [score('project_deep_dive', 'family', 80)]),
    ]);
    expect(profile.family).toHaveLength(2);
    expect(profile.family.map((s) => s.roleFamilyKey).sort()).toEqual(['backend', 'frontend']);
  });

  it('坐标缺失或无法识别的老报告不进画像', () => {
    const profile = buildProfile([
      session('old', '2026-01-01', null, [
        { key: 'professional', label: '专业技能', layer: 'family', score: 90, weight: 3 },
      ]),
      session('legacy-layerless', '2026-01-02', 'backend', [
        { key: 'middleware_database', label: 'db', layer: undefined as never, score: 90, weight: 2 },
      ]),
    ]);
    expect(profile.general).toHaveLength(0);
    expect(profile.family).toHaveLength(0);
    expect(profile.sessionCount).toBe(0);
  });

  it('按时间升序累积，与输入顺序无关', () => {
    const profile = buildProfile([
      session('later', '2026-03-01', 'backend', [score('general_logic', 'general', 90)]),
      session('earlier', '2026-01-01', 'backend', [score('general_logic', 'general', 50)]),
    ]);
    const series = profile.general.find((s) => s.key === 'general_logic')!;
    expect(series.points.map((p) => p.sessionId)).toEqual(['earlier', 'later']);
    expect(series.delta).toBe(40);
  });
});

describe('weak-questions', () => {
  const question = (overrides: Partial<InterviewQuestion>): InterviewQuestion => ({
    question: 'q',
    intent: 'i',
    rubric: { excellent: '', pass: '', fail: '' },
    followUps: [],
    referencePoints: [],
    estimatedMinutes: 5,
    difficulty: 'medium',
    dimension: 'general_logic',
    ...overrides,
  });

  it('阈值边界 59/60/61', () => {
    const weak = collectWeakQuestions([
      question({ id: 'a', score: 59, answer: 'x' }),
      question({ id: 'b', score: 60, answer: 'x' }),
      question({ id: 'c', score: 61, answer: 'x' }),
    ]);
    expect(weak.map((q) => q.id)).toEqual(['a']);
  });

  it('手动标记进入错题本，空白答案不进入', () => {
    const weak = collectWeakQuestions([
      question({ id: 'marked', score: 95, markedWeak: true, answer: 'x' }),
      question({ id: 'blank', score: 10, answer: '  ' }),
    ]);
    expect(weak.map((q) => q.id)).toEqual(['marked']);
  });

  it('重练最多 10 题，分低优先', () => {
    const many = Array.from({ length: 15 }, (_, i) => question({ id: `q${i}`, score: i, answer: 'x' }));
    const retry = planRetryQuestions(many);
    expect(retry).toHaveLength(10);
    expect(retry[0].id).toBe('q0');
    expect(retry[9].id).toBe('q9');
  });
});
