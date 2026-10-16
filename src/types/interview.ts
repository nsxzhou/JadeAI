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
  score: number | null;
  feedback: string;
}

export interface InterviewMessageMetadata {
  marked?: boolean;
  hinted?: boolean;
  skipped?: boolean;
  /** 该轮已到最后一题，前端据此转入轮次收尾。 */
  roundComplete?: boolean;
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

export interface ReportDimensionScore {
  dimension: string;
  score: number;
  maxScore: number;
}

export interface ReportQuestionEvaluation {
  question: string;
  answerSummary: string;
  score: number;
  highlights: string[];
  weaknesses: string[];
  referenceTips: string;
  marked: boolean;
  hinted: boolean;
  skipped: boolean;
}

export interface ReportRoundEvaluation {
  roundId: string;
  interviewerType: string;
  interviewerName: string;
  score: number;
  feedback: string;
  questions: ReportQuestionEvaluation[];
}

/**
 * 报告里的坐标分。阶段 4 起会被服务端算出的 DimensionScore 取代，
 * 这里先保留报告本地形态，改名以区别于领域里的 DimensionScore。
 */
export interface InterviewReport {
  id: string;
  sessionId: string;
  overallScore: number;
  dimensionScores: ReportDimensionScore[];
  roundEvaluations: ReportRoundEvaluation[];
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
    dimensionScores: ReportDimensionScore[];
    createdAt: string;
  }[];
}
