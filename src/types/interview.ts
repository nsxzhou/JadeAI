export interface InterviewerConfig {
  type: string;
  name: string;
  title: string;
  avatar: string;
  bio: string;
  style: string;
  focusAreas: string[];
  personality: string;
}

export type InterviewSessionStatus = 'preparing' | 'in_progress' | 'paused' | 'completed';
export type InterviewRoundStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type InterviewMessageRole = 'interviewer' | 'candidate' | 'system';

import type {
  DimensionScore as DomainDimensionScore,
  ImprovementItem as DomainImprovementItem,
  InterviewQuestion as DomainInterviewQuestion,
  QuestionEvaluation as DomainQuestionEvaluation,
  RoundEvaluation as DomainRoundEvaluation,
} from '@/lib/interview-core/types';

/** 领域名词统一从共享内核再导出，避免两套定义并存。 */
export type {
  DimensionConfig,
  DimensionLayer,
  DimensionScore,
  ImprovementItem,
  InterviewQuestion,
  QuestionEvaluation,
  RoundEvaluation,
} from '@/lib/interview-core/types';

export interface InterviewSession {
  id: string;
  userId: string;
  resumeId: string | null;
  jobDescription: string;
  jobTitle: string;
  selectedInterviewers: InterviewerConfig[];
  currentRound: number;
  status: InterviewSessionStatus;
  /** 每题限时（秒）；null = 不限时。字段缺失的老数据按默认 180 处理。 */
  questionTimeLimitSec?: number | null;
  /** 整场限时；null = 不限时 */
  totalTimeLimitSec?: number | null;
  /** 列表接口带出的报告摘要；详情接口不一定有 */
  reportSummary?: InterviewReportSummary | null;
  rounds?: InterviewRound[];
  report?: InterviewReport | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** 列表卡片需要的报告摘要，取自 interview_reports 的一小部分字段。 */
export interface InterviewReportSummary {
  overallScore: number;
  dimensionScores: DomainDimensionScore[];
}

export interface InterviewRound {
  id: string;
  sessionId: string;
  interviewerType: string;
  interviewerConfig: InterviewerConfig;
  sortOrder: number;
  status: InterviewRoundStatus;
  questionCount: number;
  maxQuestions: number;
  summary: RoundSummary | null;
  messages?: InterviewMessage[];
  /** 本轮的题目（来自 interview_questions），进度按它算而不是按消息条数 */
  questions?: DomainInterviewQuestion[];
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface RoundSummary {
  /** 该轮题目分数由服务端聚合；一道题都没评时为 null */
  score: number | null;
  feedback: string;
  /**
   * 逐题评估（叙述 + 档位内分）。
   *
   * 单题分数与档位的权威存储在 `interview_questions`；这里保存叙述与快照，
   * 让「汇总不重读全文」和「逐轮报告」成立，也让重试只重跑失败的那一轮。
   */
  questions?: DomainQuestionEvaluation[];
}

export interface InterviewMessageMetadata {
  marked?: boolean;
  hinted?: boolean;
  skipped?: boolean;
  /** 该轮已到最后一题，前端据此转入轮次收尾。 */
  roundComplete?: boolean;
  /** 这条消息是本题超时留下的标记，不是候选人写的答案 */
  timedOut?: boolean;
  /** 本轮题目在 DB 里的 id（阶段 5 起由槽位绑定），暂无则为 null。 */
  questionId?: string | null;
}

export interface InterviewMessage {
  id: string;
  roundId: string;
  role: InterviewMessageRole;
  content: string;
  metadata: InterviewMessageMetadata;
  createdAt: Date | string;
}

/**
 * 报告里的坐标分。阶段 4 起会被服务端算出的 DimensionScore 取代，
 * 这里先保留报告本地形态，改名以区别于领域里的 DimensionScore。
 */
export interface InterviewReport {
  id: string;
  sessionId: string;
  overallScore: number;
  /** 两层坐标的维度分，服务端算；阶段 4 起就是领域类型本身 */
  dimensionScores: DomainDimensionScore[];
  roundEvaluations: DomainRoundEvaluation[];
  overallFeedback: string;
  improvementPlan: DomainImprovementItem[];
  createdAt: Date | string;
}

export interface CreateInterviewInput {
  jobDescription: string;
  jobTitle: string;
  resumeId?: string;
  interviewers: InterviewerConfig[];
}

export interface HistoryStats {
  sessions: {
    id: string;
    jobTitle: string;
    overallScore: number;
    dimensionScores: DomainDimensionScore[];
    createdAt: string;
  }[];
}
