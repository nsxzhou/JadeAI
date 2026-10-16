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
  dimensionScores: DimensionScore[];
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
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface RoundSummary {
  score: number;
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

export interface DimensionScore {
  dimension: string;
  score: number;
  maxScore: number;
}

export interface QuestionEvaluation {
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

export interface RoundEvaluation {
  roundId: string;
  interviewerType: string;
  interviewerName: string;
  score: number;
  feedback: string;
  questions: QuestionEvaluation[];
}

export interface ImprovementItem {
  priority: 'high' | 'medium' | 'low';
  area: string;
  description: string;
  resources: string[];
}

export interface InterviewReport {
  id: string;
  sessionId: string;
  overallScore: number;
  dimensionScores: DimensionScore[];
  roundEvaluations: RoundEvaluation[];
  overallFeedback: string;
  improvementPlan: ImprovementItem[];
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
    dimensionScores: DimensionScore[];
    createdAt: string;
  }[];
}
