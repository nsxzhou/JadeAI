/**
 * 报告装配：把 AI 的逐题叙述与服务端算出的分数拼起来。
 *
 * 「可信」的定义是：报告里每一个数字都能追溯到一条原始回答。
 * 因此分数不由 AI 给出——AI 只给档位与档位内分，服务端 clamp 后落库，
 * 维度分与总分全部由服务端按两层坐标加权得出。
 */
import type { DimensionConfig, DimensionScore, InterviewQuestion, QuestionEvaluation, QuestionTier } from './types';
import { clampScoreToTier, computeDimensionScores, computeOverallScore } from './scoring';

/** AI 对一道题给出的评估（未 clamp）。 */
export interface AiQuestionEvaluation {
  questionId: string;
  tier: QuestionTier;
  score: number;
  answerSummary: string;
  highlights: string[];
  weaknesses: string[];
}

export interface AssembledRoundEvaluation {
  roundId: string;
  interviewerType: string;
  interviewerName: string;
  /** 该轮题目分数平均值；没有可评分的题时为 null */
  score: number | null;
  feedback: string;
  questions: QuestionEvaluation[];
}

export interface MessageFlags {
  marked?: boolean;
  hinted?: boolean;
}

/**
 * 装配一轮的评估。
 *
 * 覆盖率是硬约束：**有回答的题**必须被 AI 评估到，漏了就抛错让调用方重试这一轮——
 * 沉默地给个 0 分正是旧实现骗人的方式。
 * 没回答的题（空白 / 跳过 / 超时）不要求评估，保留为「未作答」。
 */
export function assembleRoundEvaluation(input: {
  roundId: string;
  interviewerType: string;
  interviewerName: string;
  /** 本轮题目（权威顺序与答案） */
  questions: InterviewQuestion[];
  aiEvaluations: AiQuestionEvaluation[];
  /** 按题目 id 取控制标记（标记 / 提示），来自该题的原始消息 */
  flags?: Record<string, MessageFlags>;
  feedback: string;
}): AssembledRoundEvaluation {
  const byId = new Map(input.aiEvaluations.map((evaluation) => [evaluation.questionId, evaluation]));
  const unknownIds = input.aiEvaluations
    .filter((evaluation) => !input.questions.some((question) => question.id === evaluation.questionId))
    .map((evaluation) => evaluation.questionId);
  if (unknownIds.length > 0) {
    throw new Error(`Round evaluation referenced unknown question ids: ${unknownIds.join(', ')}`);
  }

  const missing: string[] = [];
  const questions: QuestionEvaluation[] = input.questions.map((question) => {
    const answered = Boolean(question.answer?.trim()) && question.status !== 'skipped';
    const evaluation = question.id ? byId.get(question.id) : undefined;
    const flags = (question.id && input.flags?.[question.id]) || {};

    if (!answered) {
      return {
        questionId: question.id,
        question: question.question,
        answerSummary: '',
        answered: false,
        answer: question.answer ?? '',
        score: 0,
        highlights: [],
        weaknesses: [],
        referenceTips: question.referenceAnswer ?? '',
        marked: flags.marked ?? false,
        hinted: flags.hinted ?? false,
        skipped: question.status === 'skipped',
      };
    }

    if (!evaluation) {
      missing.push(question.id ?? '(no id)');
      return {
        questionId: question.id,
        question: question.question,
        answerSummary: '',
        answered: true,
        answer: question.answer ?? '',
        score: 0,
        highlights: [],
        weaknesses: [],
        referenceTips: question.referenceAnswer ?? '',
        marked: flags.marked ?? false,
        hinted: flags.hinted ?? false,
        skipped: false,
      };
    }

    return {
      questionId: question.id,
      question: question.question,
      answerSummary: evaluation.answerSummary,
      answered: true,
      answer: question.answer ?? '',
      tier: evaluation.tier,
      // 档位内分是 AI 给的，区间由服务端说了算。
      score: clampScoreToTier(evaluation.tier, evaluation.score),
      highlights: evaluation.highlights,
      weaknesses: evaluation.weaknesses,
      referenceTips: question.referenceAnswer ?? '',
      marked: flags.marked ?? false,
      hinted: flags.hinted ?? false,
      skipped: false,
    };
  });

  if (missing.length > 0) {
    throw new Error(`Round evaluation is missing answered questions: ${missing.join(', ')}`);
  }

  return {
    roundId: input.roundId,
    interviewerType: input.interviewerType,
    interviewerName: input.interviewerName,
    score: averageScore(questions),
    feedback: input.feedback,
    questions,
  };
}

/** 一轮分数 = 已作答题目 clamp 后分数的平均；没有可评分的题时为 null。 */
function averageScore(questions: QuestionEvaluation[]): number | null {
  const scored = questions.filter(
    (question) => question.answered && typeof question.score === 'number',
  );
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((sum, question) => sum + (question.score as number), 0) / scored.length);
}

export interface SessionReportNumbers {
  overallScore: number;
  dimensionScores: DimensionScore[];
}

/**
 * 全场数字：各轮题目合并后按两层坐标加权。
 *
 * 输入是各轮已落定的单题分，不是全文——这就是「汇总不重读全文」。
 */
export function buildSessionReportNumbers(
  dimensions: DimensionConfig[],
  questions: InterviewQuestion[],
): SessionReportNumbers {
  const dimensionScores = computeDimensionScores(dimensions, questions);
  return { overallScore: computeOverallScore(dimensionScores), dimensionScores };
}
