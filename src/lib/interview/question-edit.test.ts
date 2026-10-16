import { describe, expect, it } from 'vitest';
import { rejectedQuestionEdits } from './question-edit';

describe('rejectedQuestionEdits', () => {
  it('标记薄弱是允许的', () => {
    expect(rejectedQuestionEdits({ markedWeak: true })).toEqual([]);
    expect(rejectedQuestionEdits({ markedWeak: false })).toEqual([]);
  });

  it('改答案、改分数、改状态都被拒绝', () => {
    expect(rejectedQuestionEdits({ answer: '更好的答案' })).toEqual(['answer']);
    expect(rejectedQuestionEdits({ score: 100 })).toEqual(['score']);
    expect(rejectedQuestionEdits({ status: 'answered' })).toEqual(['status']);
    expect(rejectedQuestionEdits({ markedWeak: true, answer: 'x' })).toEqual(['answer']);
  });
});
