import { describe, expect, it } from 'vitest';
import { RESERVED_INTERVIEW_SEGMENTS, isReservedInterviewSegment } from './constants';

describe('isReservedInterviewSegment', () => {
  it('静态段名不能被当成面试场次 id', () => {
    for (const name of RESERVED_INTERVIEW_SEGMENTS) {
      expect(isReservedInterviewSegment(name)).toBe(true);
    }
  });

  it('普通短 id / UUID 不受影响', () => {
    expect(isReservedInterviewSegment('abc123')).toBe(false);
    expect(isReservedInterviewSegment('3f1e2d4c-0000-4000-8000-000000000000')).toBe(false);
  });

  it('perspective 在保留字里（与静态路由同层）', () => {
    expect(isReservedInterviewSegment('perspective')).toBe(true);
  });
});
