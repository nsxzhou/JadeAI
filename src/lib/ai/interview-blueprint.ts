/**
 * 候选人侧蓝图出题。
 *
 * 面试官视角那套已经验证过：先规划整场的题型与知识覆盖（蓝图），再按维度并发
 * 逐槽位生成，最后服务端硬校验。这里把它复用到模拟面试上——蓝图决定「问什么」，
 * 对话决定「怎么问、追问多深」。
 *
 * 失败语义：任何一步不对就抛错，调用方整次不落库、不覆盖旧题。
 */
import { generateText, type LanguageModel } from 'ai';
import { extractJson } from '@/lib/ai/extract-json';
import type { getJsonProviderOptions } from '@/lib/ai/provider';
import { interviewBlueprintOutputSchema, questionsOutputSchema } from '@/lib/ai/perspective-schema';
import { buildDimensionQuestionsPrompt, buildInterviewBlueprintPrompt } from '@/lib/ai/perspective-prompts';
import {
  assembleGeneratedQuestions,
  canonicalizeBlueprintEvidence,
  groupBlueprintSlots,
  validateBlueprint,
} from '@/lib/interview-core/blueprint';
import { totalQuestions } from '@/lib/interview-core/dimension';
import { isGoRole, ROLE_FAMILIES } from '@/lib/interview-core/role-family';
import type { DimensionConfig, InterviewQuestion, PrimaryStack, RoleFamilyKey } from '@/lib/interview-core/types';

export interface PlanSessionQuestionsInput {
  model: LanguageModel;
  /** 与 provider 相关的 JSON 模式选项，由调用方从 AIConfig 生成 */
  providerOptions: ReturnType<typeof getJsonProviderOptions>;
  dimensions: DimensionConfig[];
  /** 逐维度题数，来自 planQuestionCounts */
  questionCounts: Record<string, number>;
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
  roleFamily: RoleFamilyKey;
  primaryStack: PrimaryStack;
}

export interface PlannedSessionQuestions {
  questions: InterviewQuestion[];
  questionCounts: Record<string, number>;
}

/** 题数够多时，把岗位族的必考题型（含 Go 基础最少 2 题）交给模型。 */
export function requiredCategoryMinimums(
  roleFamily: RoleFamilyKey,
  primaryStack: PrimaryStack,
  questionCount: number,
): Array<{ category: string; min: number }> {
  if (questionCount < 8) return [];
  const required = ROLE_FAMILIES[roleFamily].requiredCategories.map((category) => ({ category, min: 1 }));
  if (isGoRole(roleFamily, primaryStack)) {
    required.push({ category: 'go_fundamentals', min: 2 });
  }
  return required;
}

export async function planSessionQuestions(
  input: PlanSessionQuestionsInput,
): Promise<PlannedSessionQuestions> {
  const questionCount = totalQuestions(input.questionCounts);
  if (questionCount <= 0) throw new Error('Session must contain at least one question.');

  const blueprintPrompt = buildInterviewBlueprintPrompt({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    resumeText: input.resumeText,
    dimensions: input.dimensions,
    questionCount,
    questionCounts: input.questionCounts,
    allowedCategories: ROLE_FAMILIES[input.roleFamily].allowedCategories,
    requiredCategoryMinimums: requiredCategoryMinimums(input.roleFamily, input.primaryStack, questionCount),
    roleFamilyKey: input.roleFamily,
  });

  const blueprintResult = await generateText({
    model: input.model,
    maxOutputTokens: 8192,
    system: blueprintPrompt.system,
    prompt: blueprintPrompt.prompt,
    providerOptions: input.providerOptions,
  });

  const extracted = canonicalizeBlueprintEvidence(
    extractJson(blueprintResult.text, interviewBlueprintOutputSchema),
  );

  // 服务端硬校验：槽位数、维度配额、题型是否属本族、evidence 是否精确命中、Go 配额。
  // 任何一条不满足都抛错，不做「差不多就行」的落库。
  const blueprint = validateBlueprint(extracted, {
    questionCount,
    dimensions: input.dimensions,
    roleFamily: input.roleFamily,
    primaryStack: input.primaryStack,
    questionCounts: input.questionCounts,
    enforceJdCoverage: true,
  });

  const groups = groupBlueprintSlots(blueprint.slots);
  const dimensionsByKey = new Map(input.dimensions.map((dimension) => [dimension.key, dimension]));

  const settled = await Promise.allSettled(
    groups.map(async (group) => {
      const dimension = dimensionsByKey.get(group.dimension);
      if (!dimension) {
        throw new Error(`Blueprint dimension "${group.dimension}" is not configured.`);
      }
      const { system, prompt } = buildDimensionQuestionsPrompt({
        jobTitle: input.jobTitle,
        jobDescription: input.jobDescription,
        resumeText: input.resumeText,
        dimensions: input.dimensions,
        dimension,
        blueprint,
        slots: group.slots,
      });

      const result = await generateText({
        model: input.model,
        maxOutputTokens: 8192,
        system,
        prompt,
        providerOptions: input.providerOptions,
      });

      return { slots: group.slots, questions: extractJson(result.text, questionsOutputSchema).questions };
    }),
  );

  const failures = settled.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    for (const [index, result] of settled.entries()) {
      if (result.status === 'rejected') {
        console.error(`[interview] dimension "${groups[index].dimension}" failed to generate:`, result.reason);
      }
    }
    throw new Error('Question generation failed for at least one dimension.');
  }

  const raw = assembleGeneratedQuestions(
    settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    questionCount,
  );

  // id 由服务端生成——模型返回的 id 可能重复或缺失，而报告与错题本要靠它对齐。
  const questions: InterviewQuestion[] = raw.map((question) => ({
    id: crypto.randomUUID(),
    dimension: question.dimension,
    category: question.category,
    source: question.source,
    evidence: question.evidence,
    question: question.question,
    intent: question.intent,
    rubric: question.rubric,
    followUps: question.followUps,
    referencePoints: question.referencePoints,
    redFlags: question.redFlags,
    referenceAnswer: question.referenceAnswer,
    estimatedMinutes: question.estimatedMinutes,
    difficulty: question.difficulty,
    status: 'pending',
  }));

  return { questions, questionCounts: input.questionCounts };
}
