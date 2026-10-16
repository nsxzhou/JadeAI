import { describe, it, expect } from 'vitest';
import { stageFromSummary } from './candidate-stage';
import type { CandidateSummary } from '@/types/perspective';

describe('stageFromSummary', () => {
  const base: CandidateSummary = {
    id: 'c1',
    name: '我的简历',
    status: 'pending',
    hasResume: false,
    questionCount: 0,
    answeredCount: 0,
    overallScore: null,
    recommendation: null,
    dimensionScores: [],
    createdAt: '2026-08-20T00:00:00.000Z',
  };

  it('按「传简历 → 生成题目 → 推演中 → 看结论」推进', () => {
    expect(stageFromSummary(base)).toBe('need_resume');
    expect(stageFromSummary({ ...base, hasResume: true })).toBe('need_questions');
    expect(stageFromSummary({ ...base, hasResume: true, questionCount: 8 })).toBe('interviewing');
    expect(
      stageFromSummary({ ...base, hasResume: true, questionCount: 8, recommendation: 'hold' }),
    ).toBe('done');
  });

  it('结论是 no_hire 也算已出结论，不会被打回第一步', () => {
    expect(stageFromSummary({ ...base, recommendation: 'no_hire' })).toBe('done');
  });
});
