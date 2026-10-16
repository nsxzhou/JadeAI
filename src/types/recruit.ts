/**
 * 面试官视角（原「招聘侧」）的类型。
 *
 * 领域名词一律从 `@/lib/interview-core` 再导出——两个模式共用同一份定义，
 * 这里只保留面试官视角自己的容器类型（目标岗位 / 简历分析 / 推演结论）。
 */
export type {
  DimensionConfig,
  DimensionLayer,
  DimensionScore,
  FollowUp,
  ImprovementItem,
  InterviewBlueprint,
  InterviewQuestion,
  InterviewQuestionCategory,
  InterviewQuestionSource,
  QuestionDifficulty,
  QuestionEvaluation,
  QuestionRubric,
  QuestionSlot,
  QuestionStatus,
  RoundEvaluation,
} from '@/lib/interview-core/types';

export {
  QUESTION_COUNT_MIN,
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_DEFAULT,
} from '@/lib/interview-core/types';

/** 旧名，等价于内核的 QuestionStatus（'pending' | 'asked' | ...）。 */
export type InterviewQuestionStatus = import('@/lib/interview-core/types').QuestionStatus;

/** 推演结论：判断的是「按这份简历会不会过」，不是真实录用决策。 */
export type Recommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire';

export type CandidateStatus = 'pending' | 'questions_ready' | 'evaluated';

export interface RecruitJob {
  id: string;
  userId: string;
  title: string;
  jobDescription: string;
  dimensions: import('@/lib/interview-core/types').DimensionConfig[];
  /** 目标岗位所在的岗位族 */
  roleFamilyKey: string;
  primaryStack: string;
  questionCount: number;
  /** 逐维度题数（面试官视角可调）；缺省时由 planQuestionCounts 推导 */
  questionCounts?: Record<string, number> | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface RecruitCandidate {
  id: string;
  jobId: string;
  name: string;
  status: CandidateStatus;
  resumeText: string;
  resumeData: unknown | null;
  questions: import('@/lib/interview-core/types').InterviewQuestion[] | null;
  transcript: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface RecruitEvaluation {
  id: string;
  candidateId: string;
  overallScore: number;
  dimensionScores: import('@/lib/interview-core/types').DimensionScore[];
  questionEvaluations: import('@/lib/interview-core/types').QuestionEvaluation[];
  recommendation: Recommendation;
  recommendationReason: string;
  strengths: string[];
  concerns: string[];
  overallComment: string;
  createdAt: Date | string;
}

/** 岗位详情页列表用：候选人 + 其评价摘要，不含大 JSON */
export interface CandidateSummary {
  id: string;
  name: string;
  status: CandidateStatus;
  /** 简历是否已填。正文不进列表响应，只给个布尔 */
  hasResume: boolean;
  questionCount: number;
  /** 已记录回答的题数，「继续面试 5/14」里的 5 */
  answeredCount: number;
  overallScore: number | null;
  recommendation: Recommendation | null;
  createdAt: Date | string;
}
