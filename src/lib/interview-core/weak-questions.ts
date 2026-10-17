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
export type WeakQuestionSource = 'mock' | 'perspective';

export interface WeakQuestionAttempt {
  /** 面试官视角的题目没有会话 id */
  sessionId: string | null;
  answer: string;
  score: number | null;
  createdAt: string;
  source: WeakQuestionSource;
}

export interface WeakQuestionEntry {
  /** 这一组的根题目 id（重练链的起点），用作列表 key 与重练依据 */
  rootId: string;
  question: InterviewQuestion;
  sessionId: string | null;
  /** 最近一次回答来自哪种玩法 */
  source: WeakQuestionSource;
  /** 这道题出自哪个目标岗位的简历分析，空表示来自模拟面试 */
  jobTitle: string;
  /** 按时间升序的历次回答（含重练） */
  attempts: WeakQuestionAttempt[];
}

export interface WeakQuestionRow {
  question: InterviewQuestion;
  sessionId: string | null;
  jobTitle?: string;
  source?: WeakQuestionSource;
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
    const attempt: WeakQuestionAttempt = {
      sessionId: row.sessionId,
      answer: row.question.answer ?? '',
      score: typeof row.question.score === 'number' ? row.question.score : null,
      createdAt: row.createdAt,
      source: row.source ?? 'mock',
    };

    if (existing) {
      existing.attempts.push(attempt);
      // 链上最新的一次代表当前状态
      if (attempt.createdAt >= existing.attempts[existing.attempts.length - 1].createdAt) {
        existing.question = row.question;
        existing.sessionId = row.sessionId;
        existing.source = attempt.source;
        existing.jobTitle = row.jobTitle ?? existing.jobTitle;
      }
    } else {
      byRoot.set(rootId, {
        rootId,
        question: row.question,
        sessionId: row.sessionId,
        source: attempt.source,
        jobTitle: row.jobTitle ?? '',
        attempts: [attempt],
      });
    }
  }

  return [...byRoot.values()].map((entry) => ({
    ...entry,
    attempts: [...entry.attempts].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  }));
}
