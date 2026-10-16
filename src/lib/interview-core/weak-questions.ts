/**
 * 错题本。
 *
 * 判定走服务端：单题分低于绝对阈值，或用户手动标记。空白答案不算已答。
 * 错题跨场保留题干与考察意图，重练时复制成一场只含错题的短面试。
 */
import type { InterviewQuestion } from './types';
import { RETRY_QUESTION_LIMIT } from './types';
import { isWeakQuestion } from './scoring';

/** 从一批题目里挑出错题，分低的排前面。 */
export function collectWeakQuestions(questions: InterviewQuestion[]): InterviewQuestion[] {
  return questions
    .filter((question) => isWeakQuestion(question))
    .sort((left, right) => (left.score ?? 0) - (right.score ?? 0));
}

/** 重练选题：最多 10 道，分低的优先。 */
export function planRetryQuestions(
  weakQuestions: InterviewQuestion[],
  limit: number = RETRY_QUESTION_LIMIT,
): InterviewQuestion[] {
  return collectWeakQuestions(weakQuestions).slice(0, Math.max(0, limit));
}

/** 错题本里的一条：题目本体 + 历次回答。 */
export interface WeakQuestionEntry {
  /** 这一组的根题目 id（重练链的起点），用作列表 key 与重练依据 */
  rootId: string;
  question: InterviewQuestion;
  sessionId: string;
  /** 按时间升序的历次回答（含重练） */
  attempts: Array<{ sessionId: string; answer: string; score: number | null; createdAt: string }>;
}

export interface WeakQuestionRow {
  question: InterviewQuestion;
  sessionId: string;
  createdAt: string;
}

/**
 * 把错题聚成「一道题 + 它的历次回答」。
 *
 * 重练是复制而不是复用：复制出来的题带 `originQuestionId` 指向原题，
 * 因此整条链的根就是原题 id。前后两次回答并排展示靠这个分组。
 */
export function groupWeakQuestions(rows: WeakQuestionRow[]): WeakQuestionEntry[] {
  const byRoot = new Map<string, WeakQuestionEntry>();

  for (const row of rows) {
    if (!isWeakQuestion(row.question)) continue;
    const rootId = row.question.originQuestionId ?? row.question.id ?? '';
    if (!rootId) continue;

    const existing = byRoot.get(rootId);
    const attempt = {
      sessionId: row.sessionId,
      answer: row.question.answer ?? '',
      score: typeof row.question.score === 'number' ? row.question.score : null,
      createdAt: row.createdAt,
    };

    if (existing) {
      existing.attempts.push(attempt);
      // 链上最新的一次代表当前状态
      if (attempt.createdAt >= existing.attempts[existing.attempts.length - 1].createdAt) {
        existing.question = row.question;
        existing.sessionId = row.sessionId;
      }
    } else {
      byRoot.set(rootId, {
        rootId,
        question: row.question,
        sessionId: row.sessionId,
        attempts: [attempt],
      });
    }
  }

  return [...byRoot.values()].map((entry) => ({
    ...entry,
    attempts: [...entry.attempts].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  }));
}
