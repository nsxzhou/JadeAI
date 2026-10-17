import { describe, it, expect } from 'vitest';
import { dimensionColor } from './dimension-colors';
import { resolveDimensions } from '@/lib/interview-core/dimension';
import { ROLE_FAMILY_KEYS, PRIMARY_STACKS } from '@/lib/interview-core/role-family';

describe('dimensionColor', () => {
  it('同一场面试里出现的维度彼此不同色（每个岗位族各验一次）', () => {
    for (const roleFamily of ROLE_FAMILY_KEYS) {
      for (const stack of PRIMARY_STACKS) {
        const keys = resolveDimensions(roleFamily, stack).map((definition) => definition.key);
        const dots = keys.map((key) => dimensionColor(key).dot);
        expect(new Set(dots).size, `${roleFamily}/${stack}`).toBe(keys.length);
      }
    }
  });

  it('同一个 key 每次都得到同一个颜色', () => {
    expect(dimensionColor('产品 sense')).toEqual(dimensionColor('产品 sense'));
  });

  it('自定义维度也拿得到颜色', () => {
    const c = dimensionColor('这是一个自定义维度');
    expect(c.dot).toBeTruthy();
    expect(c.chip).toBeTruthy();
  });

  it('取色靠 key 的哈希而不是下标——删掉一个维度，剩下的不换色', () => {
    const before = ['自定义A', '自定义B', '自定义C'].map((k) => dimensionColor(k).dot);
    const after = ['自定义B', '自定义C'].map((k) => dimensionColor(k).dot);
    expect(after).toEqual([before[1], before[2]]);
  });
});
