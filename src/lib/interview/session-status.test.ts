import { describe, expect, it } from 'vitest';
import { nextSessionStatus } from './session-status';

describe('nextSessionStatus', () => {
  it('进行中 / 准备中的面试可以暂停', () => {
    expect(nextSessionStatus('in_progress', 'pause')).toBe('paused');
    expect(nextSessionStatus('preparing', 'pause')).toBe('paused');
  });

  it('暂停是幂等的，不会重复改变状态', () => {
    expect(nextSessionStatus('paused', 'pause')).toBe('paused');
  });

  it('暂停后可以恢复，恢复也是幂等的', () => {
    expect(nextSessionStatus('paused', 'resume')).toBe('in_progress');
    expect(nextSessionStatus('in_progress', 'resume')).toBe('in_progress');
    expect(nextSessionStatus('preparing', 'resume')).toBe('in_progress');
  });

  it('已完成的面试不允许再暂停或恢复', () => {
    expect(nextSessionStatus('completed', 'pause')).toBeNull();
    expect(nextSessionStatus('completed', 'resume')).toBeNull();
  });
});
