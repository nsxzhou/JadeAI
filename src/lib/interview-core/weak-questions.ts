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
