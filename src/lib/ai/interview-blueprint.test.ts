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

/** 满足质量闸门的单题：4 条带答案的追问、完整 rubric、危险信号和参考答案。 */
function qualityQuestion() {
  return {
    dimension: 'placeholder',
    question: '讲讲你当时怎么做的？',
    intent: '看真实参与度',
    rubric: { excellent: 'a', pass: 'b', fail: 'c' },
    followUps: [
      { purpose: '要细节', question: '具体指标是多少？', answer: '给出 P95 与 QPS' },
      { purpose: '要归因', question: '哪些是你个人做的？', answer: '说清个人决策与团队分工' },
      { purpose: '反事实', question: '如果不用 Redis 呢？', answer: '给出替代方案与代价' },
      { purpose: '要教训', question: '现在会怎么改？', answer: '说出可复用的教训' },
    ],
    referencePoints: ['p'],
    redFlags: ['把团队成果说成个人成果', '只会复述默认配置'],
    referenceAnswer: '定位阶段：看监控与日志\n技术细节：命中率与延迟\n解决方案：缓存与降级\n具体指标：P95 下降 40%',
    estimatedMinutes: 5,
    difficulty: 'medium',
  };
}

function mockModel(blueprint: unknown) {
  generateTextMock.mockImplementation(async (args: { prompt: string }) => {
    if (args.prompt.includes('Plan the interview blueprint now')) {
      return { text: JSON.stringify(blueprint) };
    }
    // 每个维度一路，各要 1 道题
    return {
      text: JSON.stringify({ questions: [qualityQuestion()] }),
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

  it('某个启用维度一题都没有时整次失败', async () => {
    const slots = BLUEPRINT_SLOTS.map((slot, index) => (index === 0 ? { ...slot, dimension: 'middleware_database' } : slot));
    mockModel({ ...VALID_BLUEPRINT, slots });
    await expect(plan()).rejects.toThrow(/must contain at least 1 slot/);
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

  it('蓝图第一次校验失败时自动重试，第二次成功', async () => {
    let blueprintCalls = 0;
    generateTextMock.mockImplementation(async (args: { prompt: string }) => {
      if (args.prompt.includes('Plan the interview blueprint now')) {
        blueprintCalls += 1;
        return {
          text: JSON.stringify(
            blueprintCalls === 1
              ? { ...VALID_BLUEPRINT, slots: BLUEPRINT_SLOTS.slice(0, 5) }
              : VALID_BLUEPRINT,
          ),
        };
      }
      return {
        text: JSON.stringify({ questions: [qualityQuestion()] }),
      };
    });

    const { questions } = await plan();
    expect(questions).toHaveLength(6);
    expect(blueprintCalls).toBe(2);
  });

  it('题目字段不完整时触发质量闸门重试，不会静默降级', async () => {
    let questionCalls = 0;
    generateTextMock.mockImplementation(async (args: { prompt: string }) => {
      if (args.prompt.includes('Plan the interview blueprint now')) {
        return { text: JSON.stringify(VALID_BLUEPRINT) };
      }
      questionCalls += 1;
      if (questionCalls === 1) {
        return {
          text: JSON.stringify({
            questions: [{
              ...qualityQuestion(),
              followUps: [],
              referenceAnswer: '',
            }],
          }),
        };
      }
      return { text: JSON.stringify({ questions: [qualityQuestion()] }) };
    });

    const { questions } = await plan();
    expect(questions).toHaveLength(6);
    expect(questionCalls).toBeGreaterThan(6);
  });

  it('单个题目输出损坏时重试，且不通过缩短内容换成功率', async () => {
    let questionCalls = 0;
    const questionSystems: string[] = [];
    generateTextMock.mockImplementation(async (args: { prompt: string; system?: string }) => {
      if (args.prompt.includes('Plan the interview blueprint now')) {
        return { text: JSON.stringify(VALID_BLUEPRINT) };
      }
      questionCalls += 1;
      questionSystems.push(args.system ?? '');
      if (questionCalls === 1) return { text: 'not json at all' };
      return {
        text: JSON.stringify({ questions: [qualityQuestion()] }),
      };
    });

    const { questions } = await plan();
    expect(questions).toHaveLength(6);
    expect(questionCalls).toBeGreaterThan(6);

    const retrySystem = questionSystems.find((system) => system.includes('RETRY NOTE'));
    expect(retrySystem).toContain('do not shorten the required follow-ups or reference answer');
    // 原始质量要求仍在，没有为了重试而删掉 4–6 条追问。
    expect(retrySystem).toContain('4-6 of them');
    expect(retrySystem).toContain('referenceAnswer');
  });
});
