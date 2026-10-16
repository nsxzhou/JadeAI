import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: generateTextMock,
}));

const { planSessionQuestions } = await import('./interview-blueprint');
const { sessionDimensions } = await import('@/lib/interview/session-dimensions');
const { planQuestionCounts } = await import('@/lib/interview-core/dimension');

/** 6 题、后端 Java 栈：通用层 4 维各 1 题 + 数据库/项目深挖各 1 题。 */
const BLUEPRINT_SLOTS = [
  { category: 'project_deep_dive', source: 'resume', dimension: 'general_communication', topic: 't1', evidence: '做过订单系统', difficulty: 'medium' },
  { category: 'project_deep_dive', source: 'jd', dimension: 'general_logic', topic: 't2', evidence: '要求 MySQL 调优', difficulty: 'medium' },
  { category: 'project_deep_dive', source: 'jd', dimension: 'general_stress', topic: 't3', evidence: '要求高并发经验', difficulty: 'medium' },
  { category: 'project_deep_dive', source: 'jd', dimension: 'general_learning', topic: 't4', evidence: '要求了解消息队列', difficulty: 'medium' },
  { category: 'project_deep_dive', source: 'gap', dimension: 'middleware_database', topic: 't5', evidence: '简历未证明分库分表', difficulty: 'hard' },
  { category: 'project_deep_dive', source: 'gap', dimension: 'project_deep_dive', topic: 't6', evidence: '简历未证明压测经验', difficulty: 'hard' },
];

const VALID_BLUEPRINT = {
  resumeFacts: ['做过订单系统'],
  jdRequirements: ['要求 MySQL 调优', '要求高并发经验', '要求了解消息队列'],
  gaps: ['简历未证明分库分表', '简历未证明压测经验'],
  slots: BLUEPRINT_SLOTS,
};

function mockModel(blueprint: unknown) {
  generateTextMock.mockImplementation(async (args: { prompt: string }) => {
    if (args.prompt.includes('Plan the interview blueprint now')) {
      return { text: JSON.stringify(blueprint) };
    }
    // 每个维度一路，各要 1 道题
    return {
      text: JSON.stringify({
        questions: [{
          dimension: 'placeholder',
          question: '讲讲你当时怎么做的？',
          intent: '看真实参与度',
          rubric: { excellent: 'a', pass: 'b', fail: 'c' },
          followUps: [],
          referencePoints: ['p'],
          estimatedMinutes: 5,
          difficulty: 'medium',
        }],
      }),
    };
  });
}

async function plan(stack: 'java' | 'go' = 'java') {
  const dimensions = await sessionDimensions('zh', 'backend', stack);
  const questionCounts = planQuestionCounts({
    general: dimensions.filter((d) => d.layer === 'general'),
    family: dimensions.filter((d) => d.layer === 'family'),
    total: 6,
  });
  return planSessionQuestions({
    model: {} as never,
    providerOptions: {},
    dimensions,
    questionCounts,
    jobTitle: '后端工程师',
    jobDescription: '负责订单系统',
    resumeText: '做过订单系统',
    roleFamily: 'backend',
    primaryStack: stack,
  });
}

beforeEach(() => {
  generateTextMock.mockReset();
});

describe('planSessionQuestions', () => {
  it('合法蓝图产出与槽位一一对应的题目，并保留槽位的分类与依据', async () => {
    mockModel(VALID_BLUEPRINT);
    const { questions } = await plan();

    expect(questions).toHaveLength(6);
    // 顺序与槽位一致
    expect(questions.map((q) => q.dimension)).toEqual(BLUEPRINT_SLOTS.map((s) => s.dimension));
    expect(questions.map((q) => q.source)).toEqual(BLUEPRINT_SLOTS.map((s) => s.source));
    expect(questions.every((q) => q.id && q.status === 'pending')).toBe(true);
  });

  it('槽位数不对时整次失败，不返回任何题目', async () => {
    mockModel({ ...VALID_BLUEPRINT, slots: BLUEPRINT_SLOTS.slice(0, 5) });
    await expect(plan()).rejects.toThrow(/exactly 6 slots/);
  });

  it('维度配额不对时整次失败', async () => {
    const slots = BLUEPRINT_SLOTS.map((slot, index) => (index === 0 ? { ...slot, dimension: 'middleware_database' } : slot));
    mockModel({ ...VALID_BLUEPRINT, slots });
    await expect(plan()).rejects.toThrow(/must contain exactly/);
  });

  it('非 Go 堆栈出现 go_fundamentals 时整次失败', async () => {
    const slots = BLUEPRINT_SLOTS.map((slot, index) => (index === 0 ? { ...slot, category: 'go_fundamentals' } : slot));
    mockModel({ ...VALID_BLUEPRINT, slots });
    await expect(plan('java')).rejects.toThrow(/Non-Go stacks must not include go_fundamentals/);
  });

  it('evidence 改写过、归一化后仍命中来源列表', async () => {
    const slots = BLUEPRINT_SLOTS.map((slot, index) => (
      index === 0 ? { ...slot, evidence: '做过  订单系统' } : slot
    ));
    mockModel({ ...VALID_BLUEPRINT, slots });
    const { questions } = await plan();
    expect(questions[0].evidence).toBe('做过订单系统');
  });

  it('某一维度生成失败时整次失败', async () => {
    generateTextMock.mockImplementation(async (args: { prompt: string }) => {
      if (args.prompt.includes('Plan the interview blueprint now')) {
        return { text: JSON.stringify(VALID_BLUEPRINT) };
      }
      throw new Error('model exploded');
    });
    await expect(plan()).rejects.toThrow(/failed for at least one dimension/);
  });
});
