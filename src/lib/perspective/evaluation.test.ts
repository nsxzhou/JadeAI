import { describe, expect, it } from 'vitest';
import { finalizePerspectiveSummary, planEvaluationPool } from './evaluation';

const raw = {
  strengths: ['安俊逸能说明 RAG 召回流程'],
  concerns: ['该候选人未说明 CLI 的异常处理'],
  overallComment: '候选人安俊逸整体符合要求。该候选人仍需补充工程证据。',
  recommendation: 'hire' as const,
  recommendationReason: '候选人安俊逸具备 Agent 项目经验。',
};

describe('finalizePerspectiveSummary', () => {
  it('推演结论不保留姓名或候选人称呼', () => {
    const result = finalizePerspectiveSummary(raw, {
      ownerName: '安俊逸',
      substantiveQuestionCount: 8,
      assessedDimensionCount: 5,
      configuredDimensionCount: 7,
    });

    const narrative = JSON.stringify(result);
    expect(narrative).not.toContain('安俊逸');
    expect(narrative).not.toContain('候选人');
    expect(result.strengths[0]).toBe('能说明 RAG 召回流程');
  });

  it('题目或维度覆盖不足时强制待定并写明补面范围', () => {
    const result = finalizePerspectiveSummary(raw, {
      ownerName: '安俊逸',
      substantiveQuestionCount: 3,
      assessedDimensionCount: 3,
      configuredDimensionCount: 7,
    });

    expect(result.recommendation).toBe('hold');
    expect(result.recommendationReason).toContain('仅完成 3 道有效题');
    expect(result.recommendationReason).toContain('覆盖 3/7 个考察维度');
    expect(result.overallComment).toContain('本轮证据不足');
    expect(result.overallComment).toContain('补面');
  });
});

describe('planEvaluationPool', () => {
  const q = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    answer: '',
    score: null as number | null,
    ...overrides,
  });

  it('有逐题记录时只评这些题', () => {
    const { pool, pending } = planEvaluationPool(
      [q('a', { answer: '答了' }), q('b'), q('c', { answer: '也答了' })],
      new Set<string>(),
    );
    expect(pool.map((item) => item.id)).toEqual(['a', 'c']);
    expect(pending.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('只有整段速记时把所有题都放进来', () => {
    const { pool } = planEvaluationPool([q('a'), q('b')], new Set<string>());
    expect(pool.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('已评分或已有草稿的题不再进块——没有回答的题不会无限重评', () => {
    const { pending } = planEvaluationPool(
      [q('a', { answer: 'x', score: 70 }), q('b', { answer: 'y' }), q('c', { answer: 'z' })],
      new Set(['b']),
    );
    expect(pending.map((item) => item.id)).toEqual(['c']);
  });

  it('全部评完时 pending 为空', () => {
    const { pending } = planEvaluationPool(
      [q('a', { answer: 'x', score: 70 })],
      new Set(['a']),
    );
    expect(pending).toEqual([]);
  });
});
