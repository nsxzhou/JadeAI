import { describe, expect, it } from 'vitest';
import {
  buildInterviewBlueprintPrompt,
  buildDimensionQuestionsPrompt,
  buildPerspectiveSummaryPrompt,
  buildQuestionEvaluationPrompt,
} from './perspective-prompts';
import { normalizeQuestions } from '@/lib/perspective/questions';
import type {
  DimensionConfig,
  InterviewBlueprint,
  InterviewQuestion,
  QuestionSlot,
} from '@/types/perspective';

const DIMENSIONS: DimensionConfig[] = [
  { key: 'professional', label: '专业技能', weight: 3, layer: 'family', custom: false },
  { key: 'logic', label: '逻辑思维', weight: 2, layer: 'family', custom: false },
];

describe('buildDimensionQuestionsPrompt', () => {
  const base = {
    jobTitle: '后端工程师',
    jobDescription: '需要熟悉分布式事务',
    resumeText: '在某厂做过订单系统',
    dimensions: DIMENSIONS,
  };

  const blueprint: InterviewBlueprint = {
    resumeFacts: ['1 年 Go 经验', '项目使用 Gin、gRPC、Redis'],
    jdRequirements: ['Golang 性能优化', '熟悉 MySQL'],
    gaps: ['简历未证明 MySQL 经验'],
    slots: [
      {
        category: 'go_fundamentals',
        source: 'jd',
        dimension: 'professional',
        topic: 'GMP 调度与阻塞调用',
        evidence: 'JD 要求 Go 性能优化',
        difficulty: 'hard',
      },
      {
        category: 'project_deep_dive',
        source: 'resume',
        dimension: 'professional',
        topic: 'gRPC 服务的个人职责',
        evidence: '简历写明项目使用 gRPC',
        difficulty: 'medium',
      },
    ],
  };

  if (false) {
    buildDimensionQuestionsPrompt({
      ...base,
      dimension: DIMENSIONS[0],
      // @ts-expect-error Route-facing generation requires blueprint slots, not a legacy count.
      count: 2,
    });
  }

  it('按 slot 顺序渲染题目依据和全局事实列表', () => {
    const slots: QuestionSlot[] = [
      {
        category: 'go_fundamentals',
        source: 'jd',
        dimension: 'professional',
        topic: 'GMP scheduling and blocking calls',
        evidence: 'JD requires Go performance optimization',
        difficulty: 'hard',
      },
      {
        category: 'project_deep_dive',
        source: 'resume',
        dimension: 'professional',
        topic: 'gRPC service ownership',
        evidence: 'Resume says the project used gRPC',
        difficulty: 'medium',
      },
    ];
    const { prompt } = buildDimensionQuestionsPrompt({
      ...base,
      dimension: DIMENSIONS[0],
      blueprint,
      slots,
    });
    expect(prompt).toContain('需要熟悉分布式事务');
    expect(prompt).toContain('在某厂做过订单系统');
    expect(prompt).toContain('professional');
    expect(prompt).toContain('GMP scheduling and blocking calls');
    expect(prompt).toContain('JD requires Go performance optimization');
    expect(prompt).toContain('category: go_fundamentals');
    expect(prompt).toContain('source: jd');
    expect(prompt).toContain('gRPC service ownership');
    expect(prompt).toContain('Resume says the project used gRPC');
    expect(prompt).toContain('category: project_deep_dive');
    expect(prompt).toContain('source: resume');
    expect(prompt).toContain('1 年 Go 经验');
    expect(prompt).toContain('Golang 性能优化');
    expect(prompt).toContain('简历未证明 MySQL 经验');
    expect(prompt).toContain('one output question per slot, in order');
    const firstSlot = prompt.indexOf(`Slot 1
category: go_fundamentals
source: jd
dimension: professional
topic: GMP scheduling and blocking calls
evidence: JD requires Go performance optimization
difficulty: hard`);
    const secondSlot = prompt.indexOf(`Slot 2
category: project_deep_dive
source: resume
dimension: professional
topic: gRPC service ownership
evidence: Resume says the project used gRPC
difficulty: medium`);
    expect(firstSlot).toBeGreaterThan(-1);
    expect(secondSlot).toBeGreaterThan(firstSlot);
  });

  it('用户填的维度描述整段进 prompt', () => {
    const { prompt } = buildDimensionQuestionsPrompt({
      ...base,
      dimension: { ...DIMENSIONS[0], description: '重点问 Kafka 消息重复消费怎么处理' },
      blueprint,
      slots: blueprint.slots,
    });
    expect(prompt).toContain('重点问 Kafka 消息重复消费怎么处理');
  });

  it('没填描述时不硬塞一份英文兜底指引', () => {
    const { prompt } = buildDimensionQuestionsPrompt({
      ...base,
      dimension: DIMENSIONS[0],
      blueprint,
      slots: blueprint.slots,
    });
    expect(prompt).not.toContain('How to probe this competency');
  });

  it('告诉模型别人负责哪些维度，避免出重复的题', () => {
    const { prompt } = buildDimensionQuestionsPrompt({
      ...base,
      dimension: DIMENSIONS[0],
      blueprint,
      slots: blueprint.slots,
    });
    expect(prompt).toContain('逻辑思维');
    expect(prompt).toContain('do NOT ask about them');
  });

  it('自定义维度没有预置指引时不留空指引段', () => {
    const custom: DimensionConfig = {
      key: '产品 sense',
      label: '产品 sense',
      weight: 1,
      layer: 'family',
      custom: true,
    };
    const { prompt } = buildDimensionQuestionsPrompt({
      ...base,
      dimensions: [custom],
      dimension: custom,
      blueprint: { ...blueprint, slots: [{ ...blueprint.slots[0], dimension: custom.key }] },
      slots: [{ ...blueprint.slots[0], dimension: custom.key }],
    });
    expect(prompt).not.toContain('How to probe this competency');
  });

  it('system prompt 要求纯 JSON，且带参考答案字段', () => {
    const { system } = buildDimensionQuestionsPrompt({
      ...base,
      dimension: DIMENSIONS[0],
      blueprint,
      slots: blueprint.slots,
    });
    expect(system).toContain('JSON');
    expect(system).toContain('referenceAnswer');
  });

  it('system prompt 要求严格按输入 slots 出题，不能自主选择题型', () => {
    const { system } = buildDimensionQuestionsPrompt({
      ...base,
      dimension: DIMENSIONS[0],
      blueprint,
      slots: blueprint.slots,
    });
    expect(system).toContain('Do not choose or rebalance categories, sources, dimensions, or difficulty');
    expect(system).toContain('slot is the complete question assignment');
  });

  it('system prompt 分别约束简历题、JD 场景题和事实边界', () => {
    const { system } = buildDimensionQuestionsPrompt({
      ...base,
      dimension: DIMENSIONS[0],
      blueprint,
      slots: blueprint.slots,
    });
    expect(system).toContain('Evidence anchor');
    expect(system).toContain('Resume-backed questions');
    expect(system).toContain('JD-backed questions');
    expect(system).toContain('Never invent');
    expect(system).toContain('resumeFacts');
    expect(system).toContain('jdRequirements');
    expect(system).toContain('gaps');
    expect(system).toContain('must not imply prior experience');
  });

  it('system prompt 要求从 JD 和简历推断资历并匹配题目难度', () => {
    const { system } = buildDimensionQuestionsPrompt({
      ...base,
      dimension: DIMENSIONS[0],
      blueprint,
      slots: blueprint.slots,
    });
    expect(system).toContain('Infer the expected seniority');
    expect(system).toContain('Junior');
    expect(system).toContain('Mid-level');
    expect(system).toContain('Senior / staff');
  });

});

describe('buildInterviewBlueprintPrompt', () => {
  it('sets exact slot coverage and factual boundaries for the global blueprint', () => {
    const weightedDimensions: DimensionConfig[] = [
      {
        key: 'professional',
        label: '专业技能',
        description: '重点考察技术原理与工程取舍',
        weight: 3,
        layer: 'family',
        custom: false,
      },
      {
        key: 'logic',
        label: '逻辑思维',
        description: '重点考察问题拆解与验证路径',
        weight: 2,
        layer: 'family',
        custom: false,
      },
    ];
    const { system, prompt } = buildInterviewBlueprintPrompt({
      jobTitle: 'Golang 开发工程师',
      jobDescription: '3 年以上 Golang，熟悉 gRPC、Redis、MySQL',
      resumeText: '1 年 Go；项目使用 Gin、gRPC、Redis',
      dimensions: weightedDimensions,
      questionCount: 10,
    });

    expect(system).toContain('exactly 10 slots');
    expect(system).toContain('at least 2 go_fundamentals');
    expect(system).toContain('resumeFacts');
    expect(system).toContain('jdRequirements');
    expect(system).toContain('gaps');
    expect(system).toContain('Never convert an inference into a résumé fact');
    expect(system).toContain('easy | medium | hard');
    expect(system).toContain('If gaps is non-empty, satisfy the mandatory gap quota');
    expect(system).toContain('If gaps is empty, include at least one jd system_scenario slot');
    expect(system).toContain('jd + gap combined');
    expect(system).toContain('≥60%');
    expect(system).toContain('resume: at most 4 slots');
    expect(system).toContain('covering at least 3 distinct JD requirements');
    expect(system).toContain('professional');
    expect(system).toContain('exactly 6 slots');
    expect(system).toContain('重点考察技术原理与工程取舍');
    expect(system).toContain('logic');
    expect(system).toContain('exactly 4 slots');
    expect(system).toContain('重点考察问题拆解与验证路径');
    expect(system).toContain('at least 1 middleware_database slot');
    expect(system).toContain('at least 1 project_deep_dive slot');
    expect(system).toContain('at least 1 system_scenario slot');
    expect(system).toContain('at least 1 communication_pressure slot');
    expect(system).toContain('at least 1 hr_motivation slot');
    expect(system).toContain('copy one complete entry exactly from the corresponding source list');
    expect(prompt).toContain('Golang 开发工程师');
    expect(prompt).toContain('重点考察技术原理与工程取舍');
  });

  it('does not impose the eight-question Go portfolio on smaller interviews', () => {
    const { system } = buildInterviewBlueprintPrompt({
      jobTitle: 'Go 工程师',
      jobDescription: '精通 Go，熟悉 MySQL',
      resumeText: '使用 Go 开发服务',
      dimensions: DIMENSIONS,
      questionCount: 5,
    });

    expect(system).not.toContain('at least 1 hr_motivation slot');
    expect(system).not.toContain('at least 1 middleware_database slot');
  });

  it.each([
    [
      5,
      'Technical foundations (go_fundamentals, backend_fundamentals, middleware_database): at least 2 slots',
      'Project deep-dives: 1–1 slots',
      'System scenarios: 1–1 slots',
      'Communication and HR: 1–1 slots',
    ],
    [
      8,
      'Technical foundations (go_fundamentals, backend_fundamentals, middleware_database): at least 3 slots',
      'Project deep-dives: 2–2 slots',
      'System scenarios: 1–2 slots',
      'Communication and HR: 1–2 slots',
    ],
    [
      10,
      'Technical foundations (go_fundamentals, backend_fundamentals, middleware_database): at least 3 slots',
      'Project deep-dives: 2–3 slots',
      'System scenarios: 2–2 slots',
      'Communication and HR: 2–2 slots',
    ],
  ])('emits feasible integer portfolio constraints for %i slots', (questionCount, ...rules) => {
    const { system } = buildInterviewBlueprintPrompt({
      jobTitle: '后端工程师',
      jobDescription: '熟悉分布式系统',
      resumeText: '做过订单服务',
      dimensions: DIMENSIONS,
      questionCount,
    });

    for (const rule of rules) {
      expect(system).toContain(rule);
    }
  });
});

describe('buildQuestionEvaluationPrompt', () => {
  const questions: InterviewQuestion[] = [
    {
      id: 'q1',
      dimension: 'general_logic',
      question: '讲一个你排查过的线上问题',
      intent: '看拆解路径',
      rubric: { excellent: '有假设有验证', pass: '能说清现象', fail: '只复述结论' },
      followUps: [],
      referencePoints: ['定位手段'],
      estimatedMinutes: 8,
      difficulty: 'medium',
      answer: '我先看监控再复现',
    },
  ];

  it('题目的 id、题干、评分标准与逐题回答都进了 prompt', () => {
    const { prompt } = buildQuestionEvaluationPrompt({
      jobTitle: 'T',
      jobDescription: 'JD',
      resumeText: 'R',
      dimensions: DIMENSIONS,
      questions,
      transcript: '速记：候选人说了缓存击穿的排查过程',
    });
    expect(prompt).toContain('q1');
    expect(prompt).toContain('讲一个你排查过的线上问题');
    expect(prompt).toContain('有假设有验证');
    expect(prompt).toContain('Recorded answer: 我先看监控再复现');
    expect(prompt).toContain('候选人说了缓存击穿的排查过程');
  });

  it('只评本块的题：没传进来的题不会出现在 prompt 里', () => {
    const { prompt } = buildQuestionEvaluationPrompt({
      jobTitle: 'T',
      jobDescription: 'JD',
      resumeText: 'R',
      dimensions: DIMENSIONS,
      questions,
      transcript: 'x',
    });
    expect(prompt).not.toContain('q2');
  });

  it('system 要求档位 + 档位内分，且禁止产出维度分与总分', () => {
    const { system } = buildQuestionEvaluationPrompt({
      jobTitle: 'T',
      jobDescription: 'JD',
      resumeText: 'R',
      dimensions: DIMENSIONS,
      questions,
      transcript: 'x',
    });
    expect(system).toContain('excellent → 85-100');
    expect(system).toContain('Do NOT return dimension scores or an aggregate score');
    // 招聘视角的称呼与人口属性标签都不许出现
    expect(system).toContain('候选人');
    expect(system).toContain('“本轮未验证”');
  });

  it('客观题的参考答案进 prompt，供打分时对照；开放题不留空行', () => {
    const withAnswer = buildQuestionEvaluationPrompt({
      jobTitle: 'T',
      jobDescription: 'JD',
      resumeText: 'R',
      dimensions: DIMENSIONS,
      questions: [{ ...questions[0], referenceAnswer: 'MVCC 靠 undo log 和 read view' }],
      transcript: 'x',
    });
    expect(withAnswer.prompt).toContain('Reference answer: MVCC 靠 undo log 和 read view');

    const empty = buildQuestionEvaluationPrompt({
      jobTitle: 'T',
      jobDescription: 'JD',
      resumeText: 'R',
      dimensions: DIMENSIONS,
      questions: [{ ...questions[0], referenceAnswer: '  ' }],
      transcript: 'x',
    });
    expect(empty.prompt).not.toContain('Reference answer:');
  });
});

describe('buildPerspectiveSummaryPrompt', () => {
  it('只吃维度分与逐题结论，不重读全文', () => {
    const { prompt, system } = buildPerspectiveSummaryPrompt({
      jobTitle: 'T',
      jobDescription: 'JD',
      dimensionScores: [{ label: '沟通表达', score: 78, weight: 1 }],
      overallScore: 76,
      questionSummaries: [{
        question: '讲一个线上问题',
        answered: true,
        tier: 'pass',
        score: 78,
        weaknesses: ['没给出指标'],
      }],
    });

    expect(prompt).toContain('沟通表达: 78');
    expect(prompt).toContain('Overall score: 76');
    expect(prompt).toContain('没给出指标');
    expect(prompt).not.toContain('Interview transcript');
    expect(system).toContain('You do NOT get the raw transcript');
    expect(system).toContain('strong_hire, hire, hold, no_hire');
  });

  it('未作答的题在汇总里明确标注', () => {
    const { prompt } = buildPerspectiveSummaryPrompt({
      jobTitle: 'T',
      jobDescription: 'JD',
      dimensionScores: [],
      overallScore: 0,
      questionSummaries: [{
        question: '没答的题',
        answered: false,
        weaknesses: [],
      }],
    });
    expect(prompt).toContain('未作答');
  });
});

describe('出题 system prompt 的硬约束', () => {
  const blueprint: InterviewBlueprint = {
    resumeFacts: [],
    jdRequirements: [],
    gaps: [],
    slots: [
      {
        category: 'backend_fundamentals',
        source: 'jd',
        dimension: 'professional',
        topic: '数据库索引',
        evidence: 'JD',
        difficulty: 'medium',
      },
    ],
  };
  const { system } = buildDimensionQuestionsPrompt({
    jobTitle: 'T',
    jobDescription: 'JD',
    resumeText: 'R',
    dimensions: DIMENSIONS,
    dimension: DIMENSIONS[0],
    blueprint,
    slots: blueprint.slots,
  });

  it('明确要求题干短、且深度放在追问里', () => {
    expect(system).toContain('One sentence');
    expect(system).toMatch(/Depth lives in "followUps"/);
  });

  it('追问要 4-6 条并带目的标签', () => {
    expect(system).toContain('4-6 of them');
    for (const purpose of ['要细节', '要归因', '反事实', '挑战', '要教训']) {
      expect(system).toContain(purpose);
    }
  });

  it('要求给危险信号，且不许写成泛泛的话', () => {
    expect(system).toContain('redFlags');
    expect(system).toContain('回答不深入');
  });

  it('禁止偏题式冷知识，并要求不同题型遵循真实面试提问链', () => {
    expect(system).toContain('Do not ask for an obscure constant, default value, API name, or library name');
    expect(system).toContain('Project deep-dive stem');
    expect(system).toContain('Scenario stem');
    expect(system).toContain('Fundamentals stem');
    expect(system).toContain('Behavioral / pressure stem');
    expect(system).toContain('JD must-have');
  });

  it('返回格式里追问是「目的 + 问题」的对象', () => {
    expect(system).toContain('"followUps":[{"purpose":');
  });
});
