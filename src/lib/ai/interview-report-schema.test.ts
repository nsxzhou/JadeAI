import { describe, expect, it } from 'vitest';
import { roundEvaluationSchema, sessionSummarySchema } from './interview-report-schema';

const validQuestion = {
  questionId: 'q1',
  tier: 'pass',
  score: 70,
  answerSummary: '说得清楚',
  highlights: ['具体'],
  weaknesses: [],
};

describe('roundEvaluationSchema', () => {
  it('完整的一轮评估通过', () => {
    const parsed = roundEvaluationSchema.parse({ feedback: '本轮不错', questions: [validQuestion] });
    expect(parsed.questions).toHaveLength(1);
  });

  it('缺关键字段即报错，而不是静默补默认值', () => {
    expect(() => roundEvaluationSchema.parse({ questions: [validQuestion] })).toThrow();
    expect(() => roundEvaluationSchema.parse({ feedback: 'x' })).toThrow();
    expect(() => roundEvaluationSchema.parse({
      feedback: 'x',
      questions: [{ ...validQuestion, tier: undefined }],
    })).toThrow();
    expect(() => roundEvaluationSchema.parse({
      feedback: 'x',
      questions: [{ ...validQuestion, highlights: undefined }],
    })).toThrow();
  });

  it('非法档位被拒绝', () => {
    expect(() => roundEvaluationSchema.parse({
      feedback: 'x',
      questions: [{ ...validQuestion, tier: 'great' }],
    })).toThrow();
  });
});

describe('sessionSummarySchema', () => {
  const validSummary = {
    overallFeedback: '整体不错',
    improvementPlan: [{ priority: 'high', area: '并发', description: '补并发基础', resources: ['书'] }],
  };

  it('完整的汇总通过', () => {
    expect(sessionSummarySchema.parse(validSummary).improvementPlan).toHaveLength(1);
  });

  it('缺字段即报错', () => {
    expect(() => sessionSummarySchema.parse({ improvementPlan: validSummary.improvementPlan })).toThrow();
    expect(() => sessionSummarySchema.parse({ overallFeedback: 'x' })).toThrow();
    expect(() => sessionSummarySchema.parse({ overallFeedback: 'x', improvementPlan: [] })).toThrow();
  });

  it('非法优先级被拒绝', () => {
    expect(() => sessionSummarySchema.parse({
      overallFeedback: 'x',
      improvementPlan: [{ ...validSummary.improvementPlan[0], priority: 'urgent' }],
    })).toThrow();
  });
});
