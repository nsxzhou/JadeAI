/**
 * 面试领域的单一定义。
 *
 * 模拟面试与面试官视角是同一个概念的两个实例，它们的名词必须只有一份定义——
 * 否则「题目」「维度」在两个模式里会慢慢长成两个不同的东西，画像也就无从累积。
 * 交互形态不共享（对话式 vs 文档式），共享的边界止于名词与纯函数。
 */
import { z } from 'zod/v4';

// ── 坐标与枚举 ────────────────────────────────────────────────────────────────

/**
 * 评分坐标的两层。通用层每场必测、跨岗位族可比；族层由岗位族决定。
 * 见 docs/adr/0001-two-layer-profile-axes.md。
 */
export type DimensionLayer = 'general' | 'family';

export type RoleFamilyKey = 'backend' | 'frontend' | 'data_algo' | 'qa_infra' | 'other';

export type PrimaryStack = 'go' | 'java' | 'python' | 'node' | 'none';

/** 候选人侧题数预设：短 6 / 标准 10 / 长 15。 */
export type QuestionCountPreset = 'short' | 'standard' | 'long';

/** 压力面强度。默认温和，不做尖锐羞辱式。 */
export type StressLevel = 'gentle' | 'standard' | 'sharp';

/** 单题档位。AI 只给档位与档位内分，服务端 clamp 进档位区间。 */
export type QuestionTier = 'excellent' | 'pass' | 'fail';

export type QuestionStatus = 'pending' | 'asked' | 'answered' | 'skipped' | 'timed_out';

export type QuestionDifficulty = 'easy' | 'medium' | 'hard';

export type InterviewQuestionSource = 'resume' | 'jd' | 'gap';

/**
 * 题型。题型决定「怎么问」，与评分坐标（dimension）彻底解耦：
 * 问一道系统场景题，可能同时在考逻辑思维与数据库中间件。
 */
export type InterviewQuestionCategory =
  | 'go_fundamentals'
  | 'backend_fundamentals'
  | 'middleware_database'
  | 'project_deep_dive'
  | 'system_scenario'
  | 'communication_pressure'
  | 'hr_motivation'
  | 'frontend_fundamentals'
  | 'browser_network'
  | 'engineering_practice'
  | 'data_processing'
  | 'algorithm_complexity'
  | 'metrics_experiment'
  | 'testing_strategy'
  | 'cicd_delivery'
  | 'observability_incident'
  | 'candidate_questions';

// ── 默认值（设计文档 §8） ─────────────────────────────────────────────────────

export const QUESTION_COUNT_PRESETS: Record<QuestionCountPreset, number> = {
  short: 6,
  standard: 10,
  long: 15,
};

export const QUESTION_TIME_LIMIT_SEC = 180;
export const SESSION_TIME_LIMIT_FACTOR = 1.1;

/** 整场限时 = 题数 × 每题限时 × 1.1。 */
export function sessionTimeLimitSec(questionCount: number): number {
  return Math.round(questionCount * QUESTION_TIME_LIMIT_SEC * SESSION_TIME_LIMIT_FACTOR);
}

/** 错题阈值：单题绝对分低于它即入错题本。 */
export const WEAK_QUESTION_THRESHOLD = 60;

/** 重练一次最多复制几道错题。 */
export const RETRY_QUESTION_LIMIT = 10;

/** 面试官视角题数区间（逐维度可调，与候选人侧预设无关）。 */
export const QUESTION_COUNT_MIN = 5;
export const QUESTION_COUNT_MAX = 30;
export const QUESTION_COUNT_DEFAULT = 10;

/** 档位区间。服务端把 AI 给的分 clamp 进对应区间，维度分与总分全由服务端算。 */
export const QUESTION_TIER_RANGES: Record<QuestionTier, { min: number; max: number }> = {
  excellent: { min: 85, max: 100 },
  pass: { min: 60, max: 84 },
  fail: { min: 0, max: 59 },
};

export const DIMENSION_LAYERS: DimensionLayer[] = ['general', 'family'];

// ── 名词 ─────────────────────────────────────────────────────────────────────

export interface DimensionConfig {
  key: string;
  /** 展示用文案，由 i18n 填充 */
  label: string;
  layer: DimensionLayer;
  /**
   * 评分口径权重，正整数。只决定该维度在加权总分里的占比，不决定出几道题。
   * 出题数量见 `planQuestionCounts` / `questionCounts`。
   */
  weight: number;
  custom: boolean;
  /** 这个维度要考察什么、该怎么问，出题时进 prompt。老数据可能没有。 */
  description?: string;
}

export interface DimensionScore {
  key: string;
  label: string;
  layer: DimensionLayer;
  score: number;
  /** 计算总分时用的权重，冗余存储以便报告复现 */
  weight: number;
}

/** 一条追问。老数据里 followUps 是纯字符串，读取时会补成 purpose 为空。 */
export interface FollowUp {
  /** 这一问想拿到什么。空字符串表示老数据没标 */
  purpose: string;
  question: string;
  /** 这一问的参考答案 */
  answer?: string;
}

export interface QuestionRubric {
  excellent: string;
  pass: string;
  fail: string;
}

/** 蓝图里的一个出题槽位：定「问什么」，不定「怎么问」。 */
export interface QuestionSlot {
  /** 题型 */
  category: InterviewQuestionCategory;
  /** 事实来源：简历 / JD 场景 / 能力缺口 */
  source: InterviewQuestionSource;
  /** 计入哪个评分坐标（DimensionConfig.key） */
  dimension: string;
  topic: string;
  evidence: string;
  difficulty: QuestionDifficulty;
}

export interface InterviewBlueprint {
  resumeFacts: string[];
  jdRequirements: string[];
  gaps: string[];
  slots: QuestionSlot[];
}

/**
 * 一道题。
 *
 * 生成阶段（还没落库）只有题干相关字段；落库后才有 id / sortOrder / 评分字段。
 * 因此持久化相关字段是可选的——老数据与生成中间态都不带它们。
 */
export interface InterviewQuestion {
  id?: string;
  /** 候选人侧：属于哪一轮 */
  roundId?: string;
  /** 面试官视角：属于哪份简历分析 */
  perspectiveCandidateId?: string;
  /** 本场顺序 */
  sortOrder?: number;
  /** 计入哪个评分坐标（DimensionConfig.key） */
  dimension: string;
  category?: InterviewQuestionCategory;
  source?: InterviewQuestionSource;
  evidence?: string;
  question: string;
  intent: string;
  rubric: QuestionRubric;
  followUps: FollowUp[];
  referencePoints: string[];
  referenceAnswer?: string;
  redFlags?: string[];
  estimatedMinutes: number;
  difficulty: QuestionDifficulty;
  /** 面试中记录的候选人回答。空表示这题还没记。 */
  answer?: string;
  /** 用时与是否超时 */
  timeSpentSec?: number;
  timedOut?: boolean;
  /** AI 给的档位；服务端 clamp 后的分数写在 score */
  tier?: QuestionTier | null;
  /** 服务端落定的单题分，未评为 null */
  score?: number | null;
  /** 用户手动标记为薄弱 */
  markedWeak?: boolean;
  /** 面试记录状态。老数据读取时会根据 answer 自动补齐。 */
  status?: QuestionStatus;
  /** 重练链：这道题复制自哪道原题 */
  originQuestionId?: string;
}

// ── zod schema（模型返回值校验） ───────────────────────────────────────────────

export const dimensionConfigSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  layer: z.enum(['general', 'family']),
  weight: z.number().int().positive(),
  custom: z.boolean(),
  description: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => v ?? '')
    .pipe(z.string().max(2000)),
});

export const interviewQuestionSourceSchema = z.enum(['resume', 'jd', 'gap']);

export const interviewQuestionCategorySchema = z.enum([
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
]);

export const questionSlotSchema = z.object({
  category: interviewQuestionCategorySchema,
  source: interviewQuestionSourceSchema,
  dimension: z.string().min(1),
  topic: z.string().min(1),
  evidence: z.string().min(1),
  difficulty: z.enum(['easy', 'medium', 'hard']),
}).strict();

export const interviewBlueprintSchema = z.object({
  resumeFacts: z.array(z.string()),
  jdRequirements: z.array(z.string()),
  gaps: z.array(z.string()),
  slots: z.array(questionSlotSchema),
}).strict();

export const questionTierSchema = z.enum(['excellent', 'pass', 'fail']);

/**
 * 一道题的评估结果。两种模式共用：候选人侧缺 questionId（题目还没落库），
 * 面试官视角缺 referenceTips/marked（没有边问边标）。
 */
export interface QuestionEvaluation {
  questionId?: string;
  question: string;
  /** AI 从面试记录中定位到的回答摘要 */
  answerSummary: string;
  /** 记录中是否能找到对应回答 */
  answered?: boolean;
  /** 候选人的回答原文：报告里每个数字都能由此追溯到原始回答 */
  answer?: string;
  /** AI 给的档位；服务端 clamp 后的分数写在 score */
  tier?: QuestionTier;
  score: number;
  highlights: string[];
  weaknesses: string[];
  /** 候选人侧：给候选人的参考思路 */
  referenceTips?: string;
  marked?: boolean;
  hinted?: boolean;
  skipped?: boolean;
  /** 本题超时：报告要标注出来 */
  timedOut?: boolean;
}

/** 一轮的评估（逐轮生成，不重读全文）。 */
export interface RoundEvaluation {
  roundId: string;
  interviewerType: string;
  interviewerName: string;
  score: number;
  feedback: string;
  questions: QuestionEvaluation[];
}

/** 改进建议（报告用）。 */
export interface ImprovementItem {
  priority: 'high' | 'medium' | 'low';
  area: string;
  description: string;
  resources: string[];
}
