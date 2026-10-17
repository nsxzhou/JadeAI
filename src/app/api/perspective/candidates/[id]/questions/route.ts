import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { getModel, extractAIConfig, getJsonProviderOptions, AIConfigError } from '@/lib/ai/provider';
import { extractJson } from '@/lib/ai/extract-json';
import { interviewBlueprintOutputSchema, questionsOutputSchema } from '@/lib/ai/perspective-schema';
import { buildDimensionQuestionsPrompt, buildInterviewBlueprintPrompt } from '@/lib/ai/perspective-prompts';
import {
  assembleGeneratedQuestions,
  canonicalizeBlueprintEvidence,
  groupBlueprintSlots,
  validateBlueprint,
} from '@/lib/interview-core/blueprint';
import { totalQuestions } from '@/lib/interview-core/dimension';
import { ROLE_FAMILIES } from '@/lib/interview-core/role-family';
import { sessionDimensions } from '@/lib/interview/session-dimensions';
import { perspectiveRepository } from '@/lib/db/repositories/perspective.repository';
import { requireOwnedCandidate } from '@/lib/perspective/access';
import { normalizeJobCoordinates } from '@/lib/perspective/job-coordinates';
import type { DimensionConfig, InterviewQuestion } from '@/types/perspective';

export const maxDuration = 300;

/**
 * 按两层坐标出题。
 *
 * 评分坐标（dimension）来自内核目录 + 该岗位的自定义维度，题数来自 `questionCounts`；
 * 题型（category）由岗位族决定。两者解耦：一道系统场景题可以计入逻辑思维，
 * 一道求职动机题也可以计入沟通表达。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await requireOwnedCandidate(request, id);
    if ('error' in access) return access.error;

    const { candidate, job } = access;

    if (!candidate.resumeText) {
      return NextResponse.json(
        { error: 'Candidate resume is required before generating questions' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const locale = typeof body?.locale === 'string' ? body.locale : 'zh';

    const coordinates = normalizeJobCoordinates(job);
    const canonDimensions = await sessionDimensions(
      locale,
      coordinates.roleFamilyKey,
      coordinates.primaryStack,
    );
    // 自定义维度只参与本场评分与报告，不进能力画像（key 不在目录里）。
    const customDimensions = coordinates.dimensions.filter((dimension) => dimension.custom);
    const dimensions: DimensionConfig[] = [...canonDimensions, ...customDimensions];
    const questionCounts = coordinates.questionCounts;
    const questionCount = totalQuestions(questionCounts);

    if (dimensions.length === 0 || questionCount === 0) {
      return NextResponse.json({ error: 'No dimensions configured' }, { status: 400 });
    }

    const family = ROLE_FAMILIES[coordinates.roleFamilyKey];
    const requiredCategoryMinimums = questionCount >= 8
      ? [
        ...family.requiredCategories.map((category) => ({ category, min: 1 })),
        // 求职动机没有独立评分坐标，但题型保留：动机题的分落到它槽位的维度上。
        { category: 'hr_motivation' as const, min: 1 },
      ]
      : [];

    const aiConfig = extractAIConfig(request);
    const model = getModel(aiConfig);

    const blueprintPrompt = buildInterviewBlueprintPrompt({
      jobTitle: job.title,
      jobDescription: job.jobDescription,
      resumeText: candidate.resumeText,
      dimensions,
      questionCount,
      questionCounts,
      roleFamilyKey: coordinates.roleFamilyKey,
      allowedCategories: family.allowedCategories,
      requiredCategoryMinimums,
    });
    const blueprintResult = await generateText({
      model,
      maxOutputTokens: 8192,
      system: blueprintPrompt.system,
      prompt: blueprintPrompt.prompt,
      providerOptions: getJsonProviderOptions(aiConfig),
    });

    // 维度与题型各自独立：不再把 dimension 强行改成 category。
    const blueprint = validateBlueprint(
      canonicalizeBlueprintEvidence(
        extractJson(blueprintResult.text, interviewBlueprintOutputSchema),
      ),
      {
        questionCount,
        dimensions,
        questionCounts,
        roleFamily: coordinates.roleFamilyKey,
        primaryStack: coordinates.primaryStack,
        enforceJdCoverage: true,
      },
    );
    const groups = groupBlueprintSlots(blueprint.slots);
    const dimensionsByKey = new Map(dimensions.map((dimension) => [dimension.key, dimension]));

    // 一个维度一路请求，并发发出去。拆开出题的题目质量高得多
    // （每一路只盯一个考察点），顺带把耗时从「串行出 14 题」压到「最慢的那一路」。
    const settled = await Promise.allSettled(
      groups.map(async (group) => {
        const dimension = dimensionsByKey.get(group.dimension);
        if (!dimension) {
          throw new Error(`Blueprint dimension "${group.dimension}" is not configured.`);
        }
        const { system, prompt } = buildDimensionQuestionsPrompt({
          jobTitle: job.title,
          jobDescription: job.jobDescription,
          resumeText: candidate.resumeText,
          dimensions,
          dimension,
          blueprint,
          slots: group.slots,
        });

        const result = await generateText({
          model,
          maxOutputTokens: 8192,
          system,
          prompt,
          providerOptions: getJsonProviderOptions(aiConfig),
        });

        const parsed = extractJson(result.text, questionsOutputSchema);
        return { slots: group.slots, questions: parsed.questions };
      }),
    );

    for (const [index, result] of settled.entries()) {
      if (result.status === 'rejected') {
        console.error(
          `[perspective] dimension "${groups[index].dimension}" failed to generate:`,
          result.reason,
        );
      }
    }

    // 只有每个蓝图槽位都生成题目并恢复全局顺序后，才覆盖候选人的旧题。
    const raw = assembleGeneratedQuestions(
      settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      questionCount,
    );

    // id 由服务端生成——模型返回的 id 可能重复或缺失，而后面的评估要靠它对齐题目。
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

    const updated = await perspectiveRepository.updateCandidate(id, {
      questions,
      status: 'questions_ready',
    });
    if (job.questionCount !== questionCount) {
      await perspectiveRepository.updateJob(job.id, { questionCount });
    }

    return NextResponse.json({ candidate: updated });
  } catch (error) {
    if (error instanceof AIConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[perspective] question generation failed:', error);
    return NextResponse.json({ error: 'Failed to generate questions' }, { status: 500 });
  }
}
