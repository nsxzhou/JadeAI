/**
 * 岗位族：一组能力要求相近的岗位。
 *
 * 取代原来的 `detectGoRole` 正则——纯正则既会把 "willingness to go onsite" 判成 Go
 * 岗，也撑不起五个岗位族的题型配比。这里是静态清单 + LLM 选择：清单保证题型配比与
 * 评分坐标稳定，LLM 只负责从清单里挑一个（挑不出来就回落 `other`）。
 */
import type { LanguageModel } from 'ai';
import type { InterviewQuestionCategory, PrimaryStack, RoleFamilyKey } from './types';
import { familyDimensions } from './dimension';

export interface RoleFamilyDefinition {
  key: RoleFamilyKey;
  /** 必考主题，进蓝图 prompt */
  requiredTopics: string[];
  /** 题数够多时必须出现的题型 */
  requiredCategories: InterviewQuestionCategory[];
  /** 该族允许出现的题型；超出清单的题型一律拒绝 */
  allowedCategories: InterviewQuestionCategory[];
}

export const ROLE_FAMILIES: Record<RoleFamilyKey, RoleFamilyDefinition> = {
  backend: {
    key: 'backend',
    requiredTopics: ['语言基础', '数据库与中间件', '项目深挖', '系统场景', '沟通与压力'],
    requiredCategories: ['project_deep_dive', 'system_scenario', 'middleware_database', 'communication_pressure'],
    allowedCategories: [
      'go_fundamentals',
      'backend_fundamentals',
      'middleware_database',
      'project_deep_dive',
      'system_scenario',
      'communication_pressure',
      'hr_motivation',
      'candidate_questions',
    ],
  },
  frontend: {
    key: 'frontend',
    requiredTopics: ['前端基础', '浏览器与网络', '工程实践', '项目深挖'],
    requiredCategories: ['frontend_fundamentals', 'browser_network', 'engineering_practice', 'project_deep_dive'],
    allowedCategories: [
      'frontend_fundamentals',
      'browser_network',
      'engineering_practice',
      'project_deep_dive',
      'communication_pressure',
      'hr_motivation',
      'candidate_questions',
    ],
  },
  data_algo: {
    key: 'data_algo',
    requiredTopics: ['数据处理', '算法与复杂度', '指标与实验', '项目深挖'],
    requiredCategories: ['data_processing', 'algorithm_complexity', 'metrics_experiment', 'project_deep_dive'],
    allowedCategories: [
      'data_processing',
      'algorithm_complexity',
      'metrics_experiment',
      'project_deep_dive',
      'communication_pressure',
      'hr_motivation',
      'candidate_questions',
    ],
  },
  qa_infra: {
    key: 'qa_infra',
    requiredTopics: ['测试策略', 'CI/CD 与交付', '可观测性与故障', '项目深挖'],
    requiredCategories: ['testing_strategy', 'cicd_delivery', 'observability_incident', 'project_deep_dive'],
    allowedCategories: [
      'testing_strategy',
      'cicd_delivery',
      'observability_incident',
      'project_deep_dive',
      'communication_pressure',
      'hr_motivation',
      'candidate_questions',
    ],
  },
  // 兜底：不限制题型，但评分坐标只有通用层 4 条。
  // 过渡期容许旧目录的题型（阶段 3/5 完成重键后才收紧）。
  other: {
    key: 'other',
    requiredTopics: [],
    requiredCategories: [],
    allowedCategories: [
      'go_fundamentals',
      'backend_fundamentals',
      'middleware_database',
      'project_deep_dive',
      'system_scenario',
      'communication_pressure',
      'hr_motivation',
      'frontend_fundamentals',
      'browser_network',
      'engineering_practice',
      'data_processing',
      'algorithm_complexity',
      'metrics_experiment',
      'testing_strategy',
      'cicd_delivery',
      'observability_incident',
      'candidate_questions',
    ],
  },
};

export const ROLE_FAMILY_KEYS = Object.keys(ROLE_FAMILIES) as RoleFamilyKey[];

export const PRIMARY_STACKS: PrimaryStack[] = ['go', 'java', 'python', 'node', 'none'];

/** 未知或缺失一律回落 `other`——它是兜底而非失败态。 */
export function normalizeRoleFamily(value: string | null | undefined): RoleFamilyKey {
  return ROLE_FAMILY_KEYS.includes(value as RoleFamilyKey) ? (value as RoleFamilyKey) : 'other';
}

export function normalizePrimaryStack(value: string | null | undefined): PrimaryStack {
  return PRIMARY_STACKS.includes(value as PrimaryStack) ? (value as PrimaryStack) : 'none';
}

/** `isGoRole` 只是「后端族 + Go 栈」的简写，不再是独立的判定逻辑。 */
export function isGoRole(roleFamily: RoleFamilyKey, primaryStack: PrimaryStack): boolean {
  return roleFamily === 'backend' && primaryStack === 'go';
}

const FAMILY_KEYWORDS: Array<{ family: RoleFamilyKey; pattern: RegExp }> = [
  {
    family: 'data_algo',
    pattern: /(算法|数据(分析|开发|工程|科学)|machine learning|deep learning|\bml\b|\bai engineer|数据挖掘|推荐系统|风控建模)/iu,
  },
  {
    family: 'qa_infra',
    pattern: /((测试|质量)工程|测试开发|\bqa\b|\bsdet\b|运维|sre|devops|基础设施|infra|可观测|监控平台)/iu,
  },
  {
    family: 'frontend',
    pattern: /(前端|web ?(前端|开发)|react|vue|angular|浏览器|小程序|h5|full ?stack|全栈)/iu,
  },
  {
    family: 'backend',
    pattern: /(后端|服务端|backend|server[- ]side|微服务|分布式|中间件|数据库|\bgolang\b|go ?(开发|后端|语言|服务))/iu,
  },
];

/** 静态兜底判定：给出一个岗位族，绝不返回 undefined。 */
export function staticRoleFamily(jobTitle: string, jobDescription: string): RoleFamilyKey {
  const text = `${jobTitle}\n${jobDescription}`;
  for (const { family, pattern } of FAMILY_KEYWORDS) {
    if (pattern.test(text)) return family;
  }
  return 'other';
}

const STACK_KEYWORDS: Array<{ stack: PrimaryStack; pattern: RegExp }> = [
  { stack: 'go', pattern: /(\bgolang\b|\bgo\b(?![-a-z])|go ?(开发|后端|语言|服务))/iu },
  { stack: 'java', pattern: /(\bjava\b(?!script)|spring ?boot|jvm)/iu },
  { stack: 'python', pattern: /(\bpython\b|django|flask|fastapi)/iu },
  { stack: 'node', pattern: /(\bnode\.?js\b|\btypescript\b|\bjavascript\b|\bts\b|\bdeno\b)/iu },
];

export function staticPrimaryStack(jobTitle: string, jobDescription: string): PrimaryStack {
  const text = `${jobTitle}\n${jobDescription}`;
  for (const { stack, pattern } of STACK_KEYWORDS) {
    if (pattern.test(text)) return stack;
  }
  return 'none';
}

/** 该岗位族在给定栈下应有的族层维度 key，供调用方断言「不得出现 go_fundamentals」。 */
export function familyDimensionKeys(roleFamily: RoleFamilyKey, primaryStack: PrimaryStack): string[] {
  return familyDimensions(roleFamily, primaryStack).map((d) => d.key);
}

/**
 * 纯函数解析：显式给定了合法 key 就用它，否则用静态关键词判定。
 * 用户可在设置页覆盖 `roleFamilyKey`；这里不调模型，测试可完全离线跑。
 */
export function resolveRoleFamily(input: {
  roleFamilyKey?: string | null;
  jobTitle: string;
  jobDescription: string;
  primaryStack?: string | null;
}): { roleFamily: RoleFamilyKey; primaryStack: PrimaryStack } {
  const explicit = input.roleFamilyKey ? normalizeRoleFamily(input.roleFamilyKey) : null;
  const roleFamily = input.roleFamilyKey && explicit ? explicit : staticRoleFamily(input.jobTitle, input.jobDescription);
  const primaryStack = input.primaryStack
    ? normalizePrimaryStack(input.primaryStack)
    : staticPrimaryStack(input.jobTitle, input.jobDescription);
  return { roleFamily, primaryStack };
}

/**
 * LLM 从静态清单里选岗位族。判定漂移会污染画像坐标，所以这里只让它【选】，
 * 不让它发明：返回值必须命中清单，未知一律回落 `other`/`none`。
 */
export async function selectRoleFamily(input: {
  jobTitle: string;
  jobDescription: string;
  resumeText?: string;
  model: LanguageModel;
}): Promise<{ roleFamily: RoleFamilyKey; primaryStack: PrimaryStack }> {
  const fallback = resolveRoleFamily({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
  });

  try {
    const { generateObject } = await import('ai');
    const { z } = await import('zod/v4');
    const result = await generateObject({
      model: input.model,
      schema: z.object({
        roleFamilyKey: z.enum(['backend', 'frontend', 'data_algo', 'qa_infra', 'other']),
        primaryStack: z.enum(['go', 'java', 'python', 'node', 'none']),
      }),
      system:
        'You classify a job posting into exactly one role family and one primary language stack. ' +
        'Choose from the given options only; when unsure pick "other" / "none".',
      prompt: [
        `Job title: ${input.jobTitle}`,
        `Job description:\n${input.jobDescription}`,
        input.resumeText ? `Resume excerpt:\n${input.resumeText.slice(0, 4000)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    return {
      roleFamily: normalizeRoleFamily(result.object.roleFamilyKey),
      primaryStack: normalizePrimaryStack(result.object.primaryStack),
    };
  } catch (error) {
    console.error('selectRoleFamily failed, falling back to static rules:', error);
    return fallback;
  }
}
