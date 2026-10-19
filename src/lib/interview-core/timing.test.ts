import { describe, expect, it } from 'vitest';
import {
  elapsedSec,
  isQuestionTimedOut,
  normalizeQuestionTimeLimitSec,
  remainingQuestionSec,
  remainingSessionSec,
  sessionTimeLimitSec,
  shouldEndSession,
} from './timing';

const T0 = 1_700_000_000_000;

describe('sessionTimeLimitSec', () => {
  it('整场限时 = 题数 × 每题限时 × 1.1', () => {
    expect(sessionTimeLimitSec(10)).toBe(Math.round(10 * 180 * 1.1));
    expect(sessionTimeLimitSec(6)).toBe(Math.round(6 * 180 * 1.1));
    expect(sessionTimeLimitSec(6, 120)).toBe(Math.round(6 * 120 * 1.1));
  });

  it('不限时没有整场上限', () => {
    expect(sessionTimeLimitSec(10, null)).toBeNull();
    expect(sessionTimeLimitSec(10, 0)).toBeNull();
  });
});

describe('normalizeQuestionTimeLimitSec', () => {
  it('缺省/非法值回到默认 180 秒', () => {
    expect(normalizeQuestionTimeLimitSec(undefined)).toBe(180);
    expect(normalizeQuestionTimeLimitSec('')).toBe(180);
    expect(normalizeQuestionTimeLimitSec('   ')).toBe(180);
    expect(normalizeQuestionTimeLimitSec('abc')).toBe(180);
  });

  it('显式不限时映射为 null', () => {
    for (const value of [null, 0, 'none', 'unlimited', 'off']) {
      expect(normalizeQuestionTimeLimitSec(value)).toBeNull();
    }
  });

  it('合法秒数被规整并钳进区间', () => {
    expect(normalizeQuestionTimeLimitSec(240)).toBe(240);
    expect(normalizeQuestionTimeLimitSec('120')).toBe(120);
    expect(normalizeQuestionTimeLimitSec(5)).toBe(30);
    expect(normalizeQuestionTimeLimitSec(99_999)).toBe(3600);
  });
});

describe('remainingQuestionSec', () => {
  it('按真实时间戳递减，不因为「暂停」停下', () => {
    expect(remainingQuestionSec(T0, T0)).toBe(180);
    expect(remainingQuestionSec(T0, T0 + 60_000)).toBe(120);
    expect(remainingQuestionSec(T0, T0 + 179_000)).toBe(1);
  });

  it('超时后返回 0 且不再变小', () => {
    expect(remainingQuestionSec(T0, T0 + 180_000)).toBe(0);
    expect(remainingQuestionSec(T0, T0 + 600_000)).toBe(0);
  });

  it('没有开始时间时按满额算', () => {
    expect(remainingQuestionSec(null, T0)).toBe(180);
  });

  it('不限时永远没有倒计时，也不会超时', () => {
    expect(remainingQuestionSec(T0, T0 + 600_000, null)).toBe(0);
    expect(isQuestionTimedOut(T0, T0 + 600_000, null)).toBe(false);
    expect(elapsedSec(T0, T0 + 600_000, null)).toBe(600);
  });
});

describe('isQuestionTimedOut', () => {
  it('179 秒没超时，180 秒超时', () => {
    expect(isQuestionTimedOut(T0, T0 + 179_000)).toBe(false);
    expect(isQuestionTimedOut(T0, T0 + 180_000)).toBe(true);
  });
});

describe('remainingSessionSec / shouldEndSession', () => {
  it('整场限时独立于每题限时', () => {
    expect(remainingSessionSec(T0, T0 + 600_000, 1980)).toBe(1380);
    expect(shouldEndSession(T0, T0 + 1_980_000, 1980)).toBe(true);
    expect(shouldEndSession(T0, T0 + 1_979_000, 1980)).toBe(false);
  });
});

describe('elapsedSec', () => {
  it('超时按上限记，正常按实际记', () => {
    expect(elapsedSec(T0, T0 + 45_000)).toBe(45);
    expect(elapsedSec(T0, T0 + 300_000)).toBe(180);
  });
});
