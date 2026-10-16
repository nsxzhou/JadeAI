import { describe, expect, it } from 'vitest';
import { planInterviewTurn, resolvedQuestionCount, type TurnQuestionState } from './turn';
import type { QuestionStatus } from './types';

const q = (id: string, status: QuestionStatus = 'pending'): TurnQuestionState => ({ id, status });

describe('planInterviewTurn', () => {
  it('开场：没有候选人回答时问第一道题', () => {
    const plan = planInterviewTurn({
      questions: [q('q1'), q('q2')],
      currentQuestionId: null,
      candidateTurn: 'none',
    });
    expect(plan.askQuestionId).toBe('q1');
    expect(plan.answeringQuestionId).toBeNull();
    expect(plan.roundResolved).toBe(false);
  });

  it('回答当前题后推进到下一道未解决的题', () => {
    const plan = planInterviewTurn({
      questions: [q('q1', 'asked'), q('q2')],
      currentQuestionId: 'q1',
      candidateTurn: 'answer',
    });
    expect(plan.answeringQuestionId).toBe('q1');
    expect(plan.askQuestionId).toBe('q2');
    expect(plan.roundResolved).toBe(false);
  });

  it('请求提示不换题，继续问同一道', () => {
    const plan = planInterviewTurn({
      questions: [q('q1', 'asked'), q('q2')],
      currentQuestionId: 'q1',
      candidateTurn: 'hint',
    });
    expect(plan.askQuestionId).toBe('q1');
    expect(plan.roundResolved).toBe(false);
  });

  it('跳过当前题后推进到下一道', () => {
    const plan = planInterviewTurn({
      questions: [q('q1', 'asked'), q('q2')],
      currentQuestionId: 'q1',
      candidateTurn: 'skip',
    });
    expect(plan.askQuestionId).toBe('q2');
  });

  it('答完最后一道题时本轮结束、没有下一题', () => {
    const plan = planInterviewTurn({
      questions: [q('q1', 'answered'), q('q2', 'asked')],
      currentQuestionId: 'q2',
      candidateTurn: 'answer',
    });
    expect(plan.askQuestionId).toBeNull();
    expect(plan.roundResolved).toBe(true);
  });

  it('跳过与超时同样算解决，不会把本轮卡住', () => {
    const plan = planInterviewTurn({
      questions: [q('q1', 'skipped'), q('q2', 'timed_out'), q('q3', 'asked')],
      currentQuestionId: 'q3',
      candidateTurn: 'answer',
    });
    expect(plan.roundResolved).toBe(true);
  });

  it('currentQuestionId 失效时退回到最后一道 asked', () => {
    const plan = planInterviewTurn({
      questions: [q('q1', 'answered'), q('q2', 'asked'), q('q3')],
      currentQuestionId: 'deleted-id',
      candidateTurn: 'answer',
    });
    expect(plan.answeringQuestionId).toBe('q2');
    expect(plan.askQuestionId).toBe('q3');
  });

  it('没有题目时不算已解决，也不会崩', () => {
    const plan = planInterviewTurn({ questions: [], currentQuestionId: null, candidateTurn: 'answer' });
    expect(plan).toEqual({ answeringQuestionId: null, askQuestionId: null, roundResolved: true });
  });
});

describe('resolvedQuestionCount', () => {
  it('只数已解决（含跳过与超时）的题', () => {
    expect(resolvedQuestionCount([q('q1', 'answered'), q('q2', 'asked'), q('q3', 'timed_out')])).toBe(2);
  });
});
