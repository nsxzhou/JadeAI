import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GENERAL_DIMENSIONS, familyDimensions } from './dimension';
import { ROLE_FAMILY_KEYS, PRIMARY_STACKS } from './role-family';

const zh = JSON.parse(readFileSync('messages/zh.json', 'utf8'));
const en = JSON.parse(readFileSync('messages/en.json', 'utf8'));

/** 目录里的每个维度都必须有中英文文案，否则界面会回落到 key。 */
function allDimensionKeys(): string[] {
  const keys = new Set(GENERAL_DIMENSIONS.map((d) => d.key));
  for (const family of ROLE_FAMILY_KEYS) {
    for (const stack of PRIMARY_STACKS) {
      for (const dimension of familyDimensions(family, stack)) keys.add(dimension.key);
    }
  }
  return [...keys];
}

describe('dimension i18n coverage', () => {
  it('每个维度 key 都有中英文 label', () => {
    for (const key of allDimensionKeys()) {
      expect(zh.perspective.dimensions[key], `zh label missing: ${key}`).toBeTruthy();
      expect(en.perspective.dimensions[key], `en label missing: ${key}`).toBeTruthy();
    }
  });

  it('每个维度 key 都有中英文出题指引', () => {
    for (const key of allDimensionKeys()) {
      expect(zh.perspective.dimensions.descriptions[key], `zh guide missing: ${key}`).toBeTruthy();
      expect(en.perspective.dimensions.descriptions[key], `en guide missing: ${key}`).toBeTruthy();
    }
  });

  it('反问环节有题型文案（它不是评分坐标，只作题型标签）', () => {
    expect(zh.perspective.dimensions.candidate_questions).toBeTruthy();
    expect(en.perspective.dimensions.candidate_questions).toBeTruthy();
  });
});
