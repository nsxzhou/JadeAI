/**
 * 限时。
 *
 * 约束是真实的才有练习价值：每题 180 秒，整场 = 题数 × 180 × 1.1。
 * 「暂停」保留按钮但**计时不停**——像真实面试里走神，休息换不来思考时间。
 * 因此服务端只按真实时间戳重算，不引入暂停累计。
 */
import { QUESTION_TIME_LIMIT_SEC, SESSION_TIME_LIMIT_FACTOR, sessionTimeLimitSec } from './types';

export { sessionTimeLimitSec, QUESTION_TIME_LIMIT_SEC, SESSION_TIME_LIMIT_FACTOR };

/** 距本题超时还剩几秒；已超时返回 0。 */
export function remainingQuestionSec(
  askedAtMs: number | null | undefined,
  nowMs: number,
  limitSec: number = QUESTION_TIME_LIMIT_SEC,
): number {
  if (!askedAtMs) return limitSec;
  return Math.max(0, Math.ceil(limitSec - (nowMs - askedAtMs) / 1000));
}

export function isQuestionTimedOut(
  askedAtMs: number | null | undefined,
  nowMs: number,
  limitSec: number = QUESTION_TIME_LIMIT_SEC,
): boolean {
  if (!askedAtMs) return false;
  return nowMs - askedAtMs >= limitSec * 1000;
}

/** 距整场限时还剩几秒；已超时返回 0。 */
export function remainingSessionSec(
  startedAtMs: number | null | undefined,
  nowMs: number,
  totalTimeLimitSec: number,
): number {
  if (!startedAtMs) return totalTimeLimitSec;
  return Math.max(0, Math.ceil(totalTimeLimitSec - (nowMs - startedAtMs) / 1000));
}

/**
 * 本题实际用了多少秒。
 *
 * 超时提交按上限记（真实发生的就是「用满了」），否则按实际耗时。
 */
export function elapsedSec(
  askedAtMs: number | null | undefined,
  nowMs: number,
  limitSec: number = QUESTION_TIME_LIMIT_SEC,
): number {
  if (!askedAtMs) return 0;
  const elapsed = Math.floor((nowMs - askedAtMs) / 1000);
  return Math.min(Math.max(elapsed, 0), limitSec);
}

/**
 * 整场限时与每题限时是两条线：整场到点就该收尾，哪怕当前题还没超时。
 * 返回是否应当进入收尾。
 */
export function shouldEndSession(startedAtMs: number | null | undefined, nowMs: number, totalTimeLimitSec: number): boolean {
  if (!startedAtMs) return false;
  return nowMs - startedAtMs >= totalTimeLimitSec * 1000;
}
