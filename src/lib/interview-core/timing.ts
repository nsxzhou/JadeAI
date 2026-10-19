/**
 * 限时。
 *
 * 约束是真实的才有练习价值：每题限时可在建场时选 1/2/3/5 分钟、自定义或「不限时」；
 * 整场 = 题数 × 每题限时 × 1.1（不限时则整场也不设限）。
 * 「暂停」保留按钮但**计时不停**——像真实面试里走神，休息换不来思考时间。
 * 因此服务端只按真实时间戳重算，不引入暂停累计。
 */
import {
  QUESTION_TIME_LIMIT_MAX_SEC,
  QUESTION_TIME_LIMIT_MIN_SEC,
  QUESTION_TIME_LIMIT_SEC,
  SESSION_TIME_LIMIT_FACTOR,
  sessionTimeLimitSec,
} from './types';

export { sessionTimeLimitSec, QUESTION_TIME_LIMIT_SEC, SESSION_TIME_LIMIT_FACTOR };

/**
 * 把接口/表单里的每题限时规整成秒数。
 *
 * - `null` / `0` / `'none'` / `'unlimited'` / `'off'` → 不限时（null）
 * - 缺省或非法值 → 默认 180 秒（老客户端不发这个字段时保持原行为）
 * - 其余数值 clamp 进 [30, 3600]
 */
export function normalizeQuestionTimeLimitSec(value: unknown): number | null {
  if (value === null || value === 0 || value === 'none' || value === 'unlimited' || value === 'off') {
    return null;
  }
  if (value === undefined) return QUESTION_TIME_LIMIT_SEC;
  if (typeof value === 'string' && value.trim() === '') return QUESTION_TIME_LIMIT_SEC;

  const numeric = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return QUESTION_TIME_LIMIT_SEC;

  const rounded = Math.round(numeric);
  if (rounded <= 0) return null;
  return Math.min(QUESTION_TIME_LIMIT_MAX_SEC, Math.max(QUESTION_TIME_LIMIT_MIN_SEC, rounded));
}

/** 距本题超时还剩几秒；已超时返回 0。不限时返回 0（调用方不应展示倒计时）。 */
export function remainingQuestionSec(
  askedAtMs: number | null | undefined,
  nowMs: number,
  limitSec: number | null = QUESTION_TIME_LIMIT_SEC,
): number {
  if (limitSec === null || limitSec <= 0) return 0;
  if (!askedAtMs) return limitSec;
  return Math.max(0, Math.ceil(limitSec - (nowMs - askedAtMs) / 1000));
}

export function isQuestionTimedOut(
  askedAtMs: number | null | undefined,
  nowMs: number,
  limitSec: number | null = QUESTION_TIME_LIMIT_SEC,
): boolean {
  if (limitSec === null || limitSec <= 0 || !askedAtMs) return false;
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
  limitSec: number | null = QUESTION_TIME_LIMIT_SEC,
): number {
  if (!askedAtMs) return 0;
  const elapsed = Math.max(0, Math.floor((nowMs - askedAtMs) / 1000));
  if (limitSec === null || limitSec <= 0) return elapsed;
  return Math.min(elapsed, limitSec);
}

/**
 * 整场限时与每题限时是两条线：整场到点就该收尾，哪怕当前题还没超时。
 * 返回是否应当进入收尾。
 */
export function shouldEndSession(startedAtMs: number | null | undefined, nowMs: number, totalTimeLimitSec: number): boolean {
  if (!startedAtMs) return false;
  return nowMs - startedAtMs >= totalTimeLimitSec * 1000;
}
