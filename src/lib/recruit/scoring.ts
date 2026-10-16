/**
 * 面试官视角侧的算分入口。
 *
 * 实现已搬进 `@/lib/interview-core`——两个模式必须用同一套加权算法与题数分配，
 * 否则对同一份配置会算出两个总分。
 */
export { allocateQuestions, planQuestionCounts } from '@/lib/interview-core/dimension';
export { computeOverallScore, clampScoreToTier, computeDimensionScores } from '@/lib/interview-core/scoring';
