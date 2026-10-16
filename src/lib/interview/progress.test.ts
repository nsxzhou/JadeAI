import { describe, expect, it } from 'vitest';
import { computeInterviewProgress } from './progress';

describe('computeInterviewProgress', () => {
  it('starts at zero completed rounds, not one', () => {
    expect(computeInterviewProgress({ status: 'in_progress', currentRoundIndex: 0, totalRounds: 3 }))
      .toEqual({ completedRounds: 0, totalRounds: 3, percent: 0, isComplete: false });
  });

  it('counts the rounds before the active one as completed', () => {
    expect(computeInterviewProgress({ status: 'in_progress', currentRoundIndex: 1, totalRounds: 3 }).completedRounds).toBe(1);
    expect(computeInterviewProgress({ status: 'paused', currentRoundIndex: 2, totalRounds: 3 }).completedRounds).toBe(2);
  });

  it('shows every round completed once the session is completed', () => {
    const progress = computeInterviewProgress({ status: 'completed', currentRoundIndex: 0, totalRounds: 3 });
    expect(progress.completedRounds).toBe(3);
    expect(progress.percent).toBe(100);
    expect(progress.isComplete).toBe(true);
  });

  it('rounds the percent to a whole number', () => {
    expect(computeInterviewProgress({ status: 'in_progress', currentRoundIndex: 1, totalRounds: 3 }).percent).toBe(33);
    expect(computeInterviewProgress({ status: 'in_progress', currentRoundIndex: 2, totalRounds: 3 }).percent).toBe(67);
  });

  it('clamps an out-of-range index instead of over-reporting', () => {
    expect(computeInterviewProgress({ status: 'in_progress', currentRoundIndex: 9, totalRounds: 3 }).completedRounds).toBe(3);
    expect(computeInterviewProgress({ status: 'in_progress', currentRoundIndex: -1, totalRounds: 3 }).completedRounds).toBe(0);
  });

  it('handles a session with no rounds', () => {
    expect(computeInterviewProgress({ status: 'preparing', currentRoundIndex: 0, totalRounds: 0 })).toEqual({
      completedRounds: 0,
      totalRounds: 0,
      percent: 0,
      isComplete: false,
    });
  });
});
