import { NextRequest, NextResponse } from 'next/server';
import { getModel, extractAIConfig, getJsonProviderOptions, AIConfigError } from '@/lib/ai/provider';
import {
  generateQuestionsForBlueprint,
  generateValidatedBlueprint,
} from '@/lib/ai/interview-blueprint';
import { totalQuestions } from '@/lib/interview-core/dimension';
import { ROLE_FAMILIES } from '@/lib/interview-core/role-family';
import { sessionDimensions } from '@/lib/interview/session-dimensions';
import { perspectiveRepository } from '@/lib/db/repositories/perspective.repository';
import { requireOwnedCandidate } from '@/lib/perspective/access';
import { normalizeJobCoordinates } from '@/lib/perspective/job-coordinates';
import type {
  GenerationEvent,
  GenerationProgress,
} from '@/lib/perspective/generation-progress';
import type { DimensionConfig, InterviewQuestion } from '@/types/perspective';

export const maxDuration = 300;

/** 给前端一个可展示、但不泄露简历/模型原文的失败原因。 */
function userFacingGenerationError(error: unknown, locale: string): string {
  if (error instanceof AIConfigError) return error.message;
  const message = error instanceof Error ? error.message : '';
  const english = locale === 'en';
  if (message.includes('Blueprint generation failed')) {
    return english
      ? 'Blueprint planning failed after retries. Check that the model supports JSON output, then try again.'
      : '蓝图生成失败，已自动重试；请检查模型是否支持 JSON 输出后重试。';
  }
  if (message.includes('Failed to extract valid JSON')) {
    return english
      ? 'The model returned content that could not be parsed as JSON. Check the model settings and retry.'
      : '模型返回的内容无法解析为 JSON，请检查模型设置后重试。';
  }
  if (message.includes('Question generation failed')) {
    return english
      ? 'Question generation failed after retries. Please try again.'
      : '题目生成失败，已自动重试；请稍后重试。';
  }
  return english
    ? 'Question generation failed. Please try again.'
    : '生成失败，请稍后重试。';
}

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
    const providerOptions = getJsonProviderOptions(aiConfig);

    // 出题是一个 30–120 秒的多阶段过程。用 NDJSON 把「蓝图 / 出题 / 校验 / 保存」
    // 实时推给前端，避免用户只看到一个没有信息的 spinner。
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (event: GenerationEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            closed = true;
          }
        };
        const progress = (update: Omit<GenerationProgress, 'type'>) =>
          send({ type: 'progress', ...update });
        const forwardQuestionProgress = (update: GenerationProgress) => {
          send(update);
          if (update.phase === 'questions' && update.total > 0 && update.completed >= update.total) {
            progress({ phase: 'quality', completed: update.total, total: update.total });
          }
        };

        try {
          // 蓝图先校验再出题；随后按维度分组、每 2 题一批生成。分批和重试都复用
          // 同一套 prompt 与质量要求（4–6 条带答案的追问、三档 rubric、参考答案、
          // 危险信号、specificity gate 全部保留），不靠缩短内容换成功率。
          const blueprint = await generateValidatedBlueprint({
            model,
            providerOptions,
            jobTitle: job.title,
            jobDescription: job.jobDescription,
            resumeText: candidate.resumeText,
            dimensions,
            questionCount,
            questionCounts,
            roleFamily: coordinates.roleFamilyKey,
            primaryStack: coordinates.primaryStack,
            allowedCategories: family.allowedCategories,
            requiredCategoryMinimums,
            enforceJdCoverage: true,
            onProgress: send,
          });

          // 只有每个蓝图槽位都生成题目并恢复全局顺序后，才覆盖候选人的旧题。
          const raw = await generateQuestionsForBlueprint({
            model,
            providerOptions,
            jobTitle: job.title,
            jobDescription: job.jobDescription,
            resumeText: candidate.resumeText,
            dimensions,
            blueprint,
            questionCount,
            onProgress: forwardQuestionProgress,
          });

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

          progress({ phase: 'saving', completed: questionCount, total: questionCount });
          const updated = await perspectiveRepository.updateCandidate(id, {
            questions,
            status: 'questions_ready',
          });

          // 坐标可能是读时补齐的（例如旧「其他」岗位借一题给 role_professional），
          // 出题成功后落库，后续打开岗位配置 / 对比表时看到的就是实际使用的坐标与题数。
          const storedCounts = job.questionCounts as Record<string, number> | null;
          const countsChanged = job.questionCount !== questionCount
            || !storedCounts
            || JSON.stringify(storedCounts) !== JSON.stringify(questionCounts);
          const storedDimensions = Array.isArray(job.dimensions)
            ? (job.dimensions as DimensionConfig[])
            : [];
          const storedDimensionKeys = new Set(storedDimensions.map((dimension) => dimension.key));
          const dimensionsMissing = coordinates.dimensions.some(
            (dimension) => !storedDimensionKeys.has(dimension.key),
          );

          if (countsChanged || dimensionsMissing) {
            await perspectiveRepository.updateJob(job.id, {
              ...(countsChanged ? { questionCount, questionCounts } : {}),
              ...(dimensionsMissing ? { dimensions } : {}),
            });
          }

          send({ type: 'result', candidate: updated });
        } catch (error) {
          console.error('[perspective] question generation failed:', error);
          send({ type: 'error', error: userFacingGenerationError(error, locale) });
        } finally {
          try {
            controller.close();
          } catch {
            // 客户端可能已经断开
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if (error instanceof AIConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[perspective] question generation failed:', error);
    return NextResponse.json({ error: 'Failed to generate questions' }, { status: 500 });
  }
}
