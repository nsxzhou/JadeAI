import { describe, expect, it } from 'vitest';
import { validateBlueprint } from './blueprint';
import { resolveDimensions, toDimensionConfigs, planQuestionCounts } from './dimension';
import type { InterviewBlueprint, QuestionSlot } from './types';

const LABELS = (key: string) => key;
const dimensions = toDimensionConfigs(resolveDimensions('backend', 'go'), LABELS);

function slot(overrides: Partial<QuestionSlot>): QuestionSlot {
  return {
    category: 'project_deep_dive',
    source: 'resume',
    dimension: 'general_communication',
    topic: 't',
    evidence: '事实',
    difficulty: 'medium',
    ...overrides,
  };
}

/** 按 planQuestionCounts 造一份完全合规的 6 题蓝图。 */
function validBlueprint(): InterviewBlueprint {
  const counts = planQuestionCounts({
    general: dimensions.filter((d) => d.layer === 'general'),
    family: dimensions.filter((d) => d.layer === 'family'),
    total: 6,
  });
  const slots: QuestionSlot[] = [];
  for (const dimension of dimensions) {
    for (let i = 0; i < (counts[dimension.key] ?? 0); i += 1) {
      slots.push(slot({ dimension: dimension.key }));
    }
  }
  return { resumeFacts: ['事实'], jdRequirements: [], gaps: [], slots };
}

const options = {
  questionCount: 6,
  dimensions,
  roleFamily: 'backend' as const,
  primaryStack: 'go' as const,
};

describe('validateBlueprint', () => {
  it('槽位数必须精确等于题数', () => {
    const blueprint = { ...validBlueprint(), slots: validBlueprint().slots.slice(0, 5) };
    expect(() => validateBlueprint(blueprint, options)).toThrow(/exactly 6 slots/);
  });

  it('维度配额必须与 planQuestionCounts 一致', () => {
    const blueprint = validBlueprint();
    // 把一题从通用层挪到族层，通用层就少了一题
    blueprint.slots[0] = slot({ dimension: 'middleware_database' });
    expect(() => validateBlueprint(blueprint, options)).toThrow(/must contain exactly/);
  });

  it('evidence 必须归一化后精确命中来源列表', () => {
    const blueprint = validBlueprint();
    blueprint.slots[0] = slot({ dimension: blueprint.slots[0].dimension, evidence: '编造的事实' });
    expect(() => validateBlueprint(blueprint, options)).toThrow(/must exactly match/);
  });

  it('归一化后的 evidence（大小写/空白/标点差异）仍算命中', () => {
    const blueprint = { ...validBlueprint(), resumeFacts: ['Built   backend services', '事实'] };
    blueprint.slots[0] = slot({ dimension: blueprint.slots[0].dimension, evidence: 'built backend services' });
    expect(() => validateBlueprint(blueprint, options)).not.toThrow();
  });

  it('岗位族不允许的题型被拒绝', () => {
    const blueprint = validBlueprint();
    blueprint.slots[0] = slot({ dimension: blueprint.slots[0].dimension, category: 'frontend_fundamentals' });
    expect(() => validateBlueprint(blueprint, options)).toThrow(/not allowed for role family/);
  });

  it('非 Go 堆栈不得生成 go_fundamentals', () => {
    const javaDimensions = toDimensionConfigs(resolveDimensions('backend', 'java'), LABELS);
    const blueprint = validBlueprint();
    blueprint.slots[0] = slot({ dimension: blueprint.slots[0].dimension, category: 'go_fundamentals' });
    expect(() => validateBlueprint(blueprint, {
      ...options,
      dimensions: javaDimensions,
      primaryStack: 'java',
    })).toThrow(/Non-Go stacks must not include go_fundamentals/);
  });

  it('题数 >= 8 时族自带必考题型必须出现', () => {
    const eight = toDimensionConfigs(resolveDimensions('frontend', 'node'), LABELS);
    const counts = planQuestionCounts({
      general: eight.filter((d) => d.layer === 'general'),
      family: eight.filter((d) => d.layer === 'family'),
      total: 8,
    });
    const slots: QuestionSlot[] = [];
    for (const dimension of eight) {
      for (let i = 0; i < (counts[dimension.key] ?? 0); i += 1) {
        // 全部用 project_deep_dive，缺 frontend_fundamentals / browser_network / engineering_practice
        slots.push(slot({ dimension: dimension.key }));
      }
    }
    expect(() => validateBlueprint(
      { resumeFacts: ['事实'], jdRequirements: [], gaps: [], slots },
      { questionCount: 8, dimensions: eight, roleFamily: 'frontend', primaryStack: 'node' },
    )).toThrow(/requires a frontend_fundamentals slot/);
  });

  it('enforceJdCoverage 时 JD 覆盖不足被拒绝', () => {
    const blueprint = validBlueprint();
    expect(() => validateBlueprint(blueprint, { ...options, enforceJdCoverage: true })).toThrow();
  });
});
