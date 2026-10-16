import { z } from 'zod/v4';

/**
 * 报告生成的两段式 schema。
 *
 * 旧的 schema 给每个字段都挂了 `.default()`，形状错但合法的返回值会静默变成一份
 * 0 分空报告——这正是「报告骗人」的来源。拆成两段并去掉默认值：关键字段缺失即报错，
 * 调用方能明确失败并重试。
 *
 * 分数不由 AI 直接产出：AI 只给档位（excellent/pass/fail）与档位内分，服务端把它
 * clamp 进档位区间。维度分与总分全部由服务端算。
 */

/** 单题评估：AI 逐题产出，服务端负责 clamp 与落库。 */
export const roundQuestionEvaluationSchema = z.object({
  questionId: z.string().min(1),
  tier: z.enum(['excellent', 'pass', 'fail']),
  score: z.number(),
  answerSummary: z.string(),
  highlights: z.array(z.string()),
  weaknesses: z.array(z.string()),
}).strict();

/** 一轮的评估：输入只有本轮内容，不读全文。 */
export const roundEvaluationSchema = z.object({
  feedback: z.string().min(1),
  questions: z.array(roundQuestionEvaluationSchema),
}).strict();

/** 全场汇总：输入是各轮评估，不重读全文。 */
export const sessionSummarySchema = z.object({
  overallFeedback: z.string().min(1),
  improvementPlan: z.array(
    z.object({
      priority: z.enum(['high', 'medium', 'low']),
      area: z.string().min(1),
      description: z.string().min(1),
      resources: z.array(z.string()),
    }).strict(),
  ).min(1),
}).strict();

export type RoundEvaluationOutput = z.infer<typeof roundEvaluationSchema>;
export type SessionSummaryOutput = z.infer<typeof sessionSummarySchema>;
