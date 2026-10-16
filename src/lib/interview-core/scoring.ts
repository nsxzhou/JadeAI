/**
 * 服务端算分。
 *
 * 分数不由 AI 直接给出：AI 只给「档位 + 档位内分」，服务端把它 clamp 进档位区间，
 * 再按维度权重聚合维度分、按维度分聚合总分。LLM 的算术不可靠，而画像要能跨场次比较，
 * 就必须保证同一份回答在任何时候都算出同一个数。
 */
import type { DimensionConfig, DimensionScore, InterviewQuestion, QuestionTier } from './types';
import { QUESTION_TIER_RANGES, WEAK_QUESTION_THRESHOLD as WEAK_THRESHOLD } from './types';

/** 把 AI 给的档位内分 clamp 进该档位区间。档位非法时按 pass 处理。 */
export function clampScoreToTier(tier: QuestionTier | null | undefined, score: number): number {
  const range = QUESTION_TIER_RANGES[tier ?? 'pass'] ?? QUESTION_TIER_RANGES.pass;
  const value = Number.isFinite(score) ? Math.round(score) : range.min;
  return Math.min(range.max, Math.max(range.min, value));
}

/** 档位归属：给定分数落到哪个档位，用于报告展示与断言。 */
export function tierOfScore(score: number): QuestionTier {
  if (score >= QUESTION_TIER_RANGES.excellent.min) return 'excellent';
  if (score >= QUESTION_TIER_RANGES.pass.min) return 'pass';
  return 'fail';
}

/**
 * 单题是否算薄弱：服务端绝对阈值，外加用户手动标记。
 *
 * 不用相对阈值——它会跟着你一起退步；不用纯 AI 判定——同一份回答两次跑会漂。
 * 空白答案不算已答，自然也不进错题本。
 */
export function isWeakQuestion(question: Pick<InterviewQuestion, 'score' | 'markedWeak' | 'answer'>): boolean {
  // 空白答案不算已答，自然也不进错题本（包括手动标记了但没写的）。
  if (!question.answer || !question.answer.trim()) return false;
  if (question.markedWeak) return true;
  return typeof question.score === 'number' && question.score < WEAK_THRESHOLD;
}

/**
 * 维度分 = 该维度下已评分题目的平均分。
 *
 * 一道题都没答的维度 weight 置 0——它不该把总分拉低，也不该被当成 0 分。
 * `weight` 取自 DimensionConfig 的评分口径，与出题数量无关。
 */
export function computeDimensionScores(
  dimensions: DimensionConfig[],
  questions: Array<Pick<InterviewQuestion, 'dimension' | 'score' | 'status' | 'answer'>>,
): DimensionScore[] {
  return dimensions.map((dimension) => {
    const scored = questions.filter(
      (question) =>
        question.dimension === dimension.key
        && typeof question.score === 'number'
        && (question.answer ?? '').trim().length > 0,
    );

    const score = scored.length > 0
      ? Math.round(scored.reduce((sum, question) => sum + (question.score as number), 0) / scored.length)
      : 0;

    return {
      key: dimension.key,
      label: dimension.label,
      layer: dimension.layer,
      score,
      weight: scored.length > 0 ? dimension.weight : 0,
    };
  });
}

/**
 * 加权总分。
 *
 * weight <= 0 的维度被排除——某个维度一道题都没问到，调用方把它的 weight 置 0，
 * 该维度就不会把总分拉低。权重和为 0 时返回 0。
 */
export function computeOverallScore(scores: DimensionScore[]): number {
  const usable = scores.filter((s) => s.weight > 0);
  const totalWeight = usable.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = usable.reduce((sum, s) => sum + s.score * s.weight, 0);
  return Math.round(weighted / totalWeight);
}

/** 一轮的分数 = 该轮已评分题目的平均分；没有已评分题目时为 null。 */
export function computeRoundScore(questions: Array<Pick<InterviewQuestion, 'score' | 'answer'>>): number | null {
  const scored = questions.filter(
    (question) => typeof question.score === 'number' && (question.answer ?? '').trim().length > 0,
  );
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((sum, question) => sum + (question.score as number), 0) / scored.length);
}
