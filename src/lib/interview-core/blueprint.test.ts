import { describe, expect, it } from 'vitest';
import {
  assembleGeneratedQuestions,
  bindQuestionsToSlots,
  canonicalizeBlueprintEvidence,
  groupBlueprintSlots,
  validateBlueprint,
} from './blueprint';
import { resolveDimensions, toDimensionConfigs, planQuestionCounts } from './dimension';
import type { InterviewBlueprint, InterviewQuestion, QuestionSlot } from './types';

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

  it('岗位专业能力槽位不得退化成沟通/动机题', () => {
    const otherDimensions = toDimensionConfigs(resolveDimensions('other', 'none'), LABELS);
    const counts = planQuestionCounts({
      general: otherDimensions.filter((dimension) => dimension.layer === 'general'),
      family: otherDimensions.filter((dimension) => dimension.layer === 'family'),
      total: 10,
    });
    const slots: QuestionSlot[] = [];
    for (const dimension of otherDimensions) {
      for (let i = 0; i < (counts[dimension.key] ?? 0); i += 1) {
        slots.push(slot({
          dimension: dimension.key,
          category: 'project_deep_dive',
          source: 'jd',
          evidence: 'JD 要求',
        }));
      }
    }
    const professional = slots.find((entry) => entry.dimension === 'role_professional');
    expect(professional).toBeDefined();
    professional!.category = 'communication_pressure';

    expect(() => validateBlueprint(
      { resumeFacts: [], jdRequirements: ['JD 要求'], gaps: [], slots },
      {
        questionCount: 10,
        dimensions: otherDimensions,
        roleFamily: 'other',
        primaryStack: 'none',
        questionCounts: counts,
        enforceJdCoverage: false,
      },
    )).toThrow(/role_professional/);
  });
});

// ── 从旧适配层（`@/lib/ai/perspective-blueprint`）搬过来的用例 ────────────────
// 泛化后这两个函数只在内核里存在一份，测试也跟着走。

describe('canonicalizeBlueprintEvidence', () => {
  it('把模型改写的证据绑定回对应来源列表中的原文', () => {
    const result = canonicalizeBlueprintEvidence({
      resumeFacts: ['负责高并发服务开发', '参与前端页面维护'],
      jdRequirements: ['熟悉 Redis 和 Kafka'],
      gaps: [],
      slots: [{
        category: 'project_deep_dive',
        source: 'resume',
        dimension: 'project_deep_dive',
        topic: '高并发服务',
        evidence: '候选人负责过高并发后端服务的开发',
        difficulty: 'medium',
      }],
    });

    expect(result.slots[0].evidence).toBe('负责高并发服务开发');
  });
});

function rawQuestion(question: string): InterviewQuestion {
  return {
    dimension: '模型乱给的维度',
    category: 'hr_motivation',
    source: 'resume',
    evidence: '模型乱给的证据',
    question,
    intent: 'i',
    rubric: { excellent: '', pass: '', fail: '' },
    followUps: [],
    referencePoints: [],
    estimatedMinutes: 5,
    difficulty: 'easy',
  };
}

describe('groupBlueprintSlots / bindQuestionsToSlots / assembleGeneratedQuestions', () => {
  it('按维度分组并保留槽位原始下标', () => {
    const slots: QuestionSlot[] = [
      slot({ dimension: 'general_communication' }),
      slot({ dimension: 'middleware_database' }),
      slot({ dimension: 'general_communication' }),
    ];
    expect(groupBlueprintSlots(slots)).toEqual([
      {
        dimension: 'general_communication',
        slots: [{ ...slots[0], slotIndex: 0 }, { ...slots[2], slotIndex: 2 }],
      },
      { dimension: 'middleware_database', slots: [{ ...slots[1], slotIndex: 1 }] },
    ]);
  });

  it('题目的 category/source/dimension/evidence/difficulty 一律以槽位为准', () => {
    const [bound] = bindQuestionsToSlots([rawQuestion('q')], [slot({ dimension: 'middleware_database' })]);
    expect(bound).toMatchObject({
      dimension: 'middleware_database',
      category: 'project_deep_dive',
      source: 'resume',
      evidence: '事实',
    });
  });

  it('位置对齐只取较短的一侧', () => {
    expect(bindQuestionsToSlots([rawQuestion('a'), rawQuestion('b')], [slot({})])).toHaveLength(1);
    expect(bindQuestionsToSlots([rawQuestion('a')], [slot({}), slot({})])).toHaveLength(1);
  });

  it('按槽位下标还原整场顺序', () => {
    const slots: QuestionSlot[] = [
      slot({ dimension: 'general_communication' }),
      slot({ dimension: 'middleware_database' }),
      slot({ dimension: 'general_communication' }),
    ];
    const groups = groupBlueprintSlots(slots).map((group) => ({
      slots: group.slots,
      questions: group.dimension === 'general_communication'
        ? [rawQuestion('A'), rawQuestion('C')]
        : [rawQuestion('B')],
    }));

    expect(assembleGeneratedQuestions(groups, 3).map((question) => question.question)).toEqual(['A', 'B', 'C']);
  });

  it('数量对不上就整次失败，不截断', () => {
    const slots = Array.from({ length: 10 }, (_, index) => slot({ topic: `topic ${index}` }));
    const [group] = groupBlueprintSlots(slots);

    expect(() => assembleGeneratedQuestions([{
      slots: group.slots,
      questions: Array.from({ length: 11 }, (_, index) => rawQuestion(`q${index}`)),
    }], 10)).toThrow(/exactly 10/);
  });
});
