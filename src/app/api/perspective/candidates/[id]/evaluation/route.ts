import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { getModel, extractAIConfig, getJsonProviderOptions, AIConfigError } from '@/lib/ai/provider';
import { extractJson } from '@/lib/ai/extract-json';
import { perspectiveSummaryOutputSchema, questionChunkEvaluationSchema } from '@/lib/ai/perspective-schema';
import { buildPerspectiveSummaryPrompt, buildQuestionEvaluationPrompt } from '@/lib/ai/perspective-prompts';
import { clampScoreToTier, computeDimensionScores, computeOverallScore } from '@/lib/interview-core/scoring';
import { sessionDimensions } from '@/lib/interview/session-dimensions';
import { finalizePerspectiveSummary, planEvaluationPool } from '@/lib/perspective/evaluation';
import { normalizeJobCoordinates } from '@/lib/perspective/job-coordinates';
import { perspectiveRepository } from '@/lib/db/repositories/perspective.repository';
import { requireOwnedCandidate } from '@/lib/perspective/access';
import type { DimensionConfig, DimensionScore, InterviewQuestion, QuestionEvaluation } from '@/types/perspective';

export const maxDuration = 300;

/** 一次评几道题。块越小越不容易整块失败，块越大调用次数越少。 */
const CHUNK_SIZE = 5;

function hasAnswer(question: InterviewQuestion): boolean {
  return Boolean(question.answer?.trim());
}

function isScored(question: InterviewQuestion): boolean {
  return typeof question.score === 'number';
}

function toEvaluation(
  question: InterviewQuestion,
  raw: {
    answered: boolean;
    tier?: 'excellent' | 'pass' | 'fail';
    score: number;
    answerSummary: string;
    highlights: string[];
    weaknesses: string[];
  },
): QuestionEvaluation {
  const score = raw.answered ? clampScoreToTier(raw.tier, raw.score) : 0;
  return {
    questionId: question.id ?? '',
    question: question.question,
    answerSummary: raw.answerSummary,
    answered: raw.answered,
    answer: question.answer ?? '',
    tier: raw.answered ? (raw.tier ?? 'pass') : undefined,
    score,
    highlights: raw.highlights,
    weaknesses: raw.weaknesses,
  };
}

async function dimensionsForJob(candidateJob: Parameters<typeof normalizeJobCoordinates>[0], locale: string) {
  const coordinates = normalizeJobCoordinates(candidateJob);
  const canon = await sessionDimensions(locale, coordinates.roleFamilyKey, coordinates.primaryStack);
  const custom = coordinates.dimensions.filter((dimension) => dimension.custom);
  return { coordinates, dimensions: [...canon, ...custom] as DimensionConfig[] };
}

/** 报告页用它决定显示「还没有报告 / 继续生成 / 已完成」。 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireOwnedCandidate(request, id);
  if ('error' in access) return access.error;

  const questions = await perspectiveRepository.findQuestionsByCandidateId(id);
  const evaluation = await perspectiveRepository.findEvaluation(id);
  const evaluated = questions.filter(isScored).length;
  const status = evaluation
    ? (evaluated >= questions.filter(hasAnswer).length && evaluated > 0 ? 'complete' : 'partial')
    : evaluated > 0
      ? 'partial'
      : 'none';

  return NextResponse.json({
    status,
    evaluated,
    total: questions.length,
    evaluation: evaluation ?? null,
  });
}

/**
 * 分块两段式评估。
 *
 * 每次调用只评「第一块还没评过的题」，评完把单题分（档位 + clamp 后的分）落库；
 * 全部题目评完之后才跑汇总段，维度分与总分由服务端算，AI 只产出结论文字。
 *
 * `restart: true` 清空已有单题分与评价，从头再跑一遍（报告页的「重新生成」）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await requireOwnedCandidate(request, id);
    if ('error' in access) return access.error;

    const { candidate, job } = access;
    const body = await request.json().catch(() => ({}));
    const locale = typeof body?.locale === 'string' ? body.locale : 'zh';
    const restart = body?.restart === true;

    const allQuestions = await perspectiveRepository.findQuestionsByCandidateId(id);
    if (allQuestions.length === 0) {
      return NextResponse.json({ error: 'Generate questions first' }, { status: 400 });
    }

    if (restart) {
      await perspectiveRepository.resetEvaluation(id);
      for (const question of allQuestions) {
        if (question.id) await perspectiveRepository.updateQuestionScore(question.id, { tier: null, score: null });
      }
    }

    const questions = restart
      ? allQuestions.map((question) => ({ ...question, tier: null, score: null }))
      : allQuestions;

    const recorded = questions.filter(hasAnswer);

    const { coordinates, dimensions } = await dimensionsForJob(job, locale);
    const aiConfig = extractAIConfig(request);
    const model = getModel(aiConfig);
    const providerOptions = getJsonProviderOptions(aiConfig);

    // 已经评过（有单题分，或已经有一条评估草稿）的题不再进块——没有回答的题可能永远
    // 拿不到分数，只按分数判断会让它被反复重新评估、循环到天荒地老。
    const draftBefore = restart ? null : await perspectiveRepository.findEvaluation(id);
    const draftedIds = new Set<string>(
      ((draftBefore?.questionEvaluations ?? []) as QuestionEvaluation[])
        .map((item) => item.questionId)
        .filter((questionId): questionId is string => Boolean(questionId)),
    );
    const { pool, pending } = planEvaluationPool(questions, draftedIds);
    if (recorded.length === 0 && !candidate.transcript?.trim()) {
      return NextResponse.json({ error: 'Interview transcript is required' }, { status: 400 });
    }
    const chunk = pending.slice(0, CHUNK_SIZE);

    // ── 第一段：逐题评估 ────────────────────────────────────────────────────
    if (chunk.length > 0) {
      const { system, prompt } = buildQuestionEvaluationPrompt({
        jobTitle: job.title,
        jobDescription: job.jobDescription,
        resumeText: candidate.resumeText,
        dimensions,
        questions: chunk,
        transcript: candidate.transcript,
      });

      let parsed;
      try {
        const result = await generateText({ model, maxOutputTokens: 8192, system, prompt, providerOptions });
        parsed = extractJson(result.text, questionChunkEvaluationSchema);
      } catch (error) {
        console.error('[perspective] question chunk evaluation failed:', error);
        return NextResponse.json({
          status: 'partial',
          evaluated: pool.length - pending.length,
          total: pool.length,
          failedQuestionIds: chunk.map((question) => question.id),
          error: '这一块的评估生成失败，可重试；已评的题不会重跑。',
        });
      }

      const byId = new Map(parsed.questionEvaluations.map((item) => [item.questionId, item]));
      const evaluations: QuestionEvaluation[] = [];
      for (const question of chunk) {
        const raw = byId.get(question.id ?? '');
        // 模型漏评的题按「未作答」处理，绝不补一个 0 分当成「答得差」。
        const evaluation = toEvaluation(question, {
          answered: raw?.answered ?? false,
          tier: raw?.tier,
          score: raw?.score ?? 0,
          answerSummary: raw?.answerSummary ?? '',
          highlights: raw?.highlights ?? [],
          weaknesses: raw?.weaknesses ?? [],
        });
        evaluations.push(evaluation);

        if (question.id && (recorded.length === 0 || evaluation.answered)) {
          await perspectiveRepository.updateQuestionScore(question.id, {
            tier: evaluation.tier ?? null,
            score: evaluation.answered ? evaluation.score : null,
          });
        }
      }

      await perspectiveRepository.saveEvaluationChunk(id, evaluations);

      const evaluated = pool.length - Math.max(0, pending.length - chunk.length);

      return NextResponse.json({
        status: 'partial',
        evaluated,
        total: pool.length,
        remaining: Math.max(0, pending.length - chunk.length),
      });
    }

    // ── 第二段：汇总（不重读全文） ──────────────────────────────────────────
    const latestQuestions = await perspectiveRepository.findQuestionsByCandidateId(id);
    const dimensionScores: DimensionScore[] = computeDimensionScores(dimensions, latestQuestions);
    const overallScore = computeOverallScore(dimensionScores);
    const draft = await perspectiveRepository.findEvaluation(id);
    const draftEvaluations = ((draft?.questionEvaluations ?? []) as QuestionEvaluation[]);
    const draftById = new Map(draftEvaluations.map((item) => [item.questionId, item]));

    const answeredIds = latestQuestions
      .filter((question) => isScored(question) && hasAnswer(question))
      .map((question) => question.id ?? '');
    const answeredDimensions = new Set(
      latestQuestions
        .filter((question) => answeredIds.includes(question.id ?? ''))
        .map((question) => question.dimension),
    );

    const { system, prompt } = buildPerspectiveSummaryPrompt({
      jobTitle: job.title,
      jobDescription: job.jobDescription,
      dimensionScores: dimensionScores.map((dimension) => ({
        label: dimension.label,
        score: dimension.score,
        weight: dimension.weight,
      })),
      overallScore,
      questionSummaries: latestQuestions.map((question) => {
        const evaluation = draftById.get(question.id ?? '');
        return {
          question: question.question,
          answered: Boolean(evaluation?.answered),
          tier: evaluation?.tier ?? null,
          score: evaluation?.score ?? null,
          weaknesses: evaluation?.weaknesses ?? [],
        };
      }),
    });

    const summaryResult = await generateText({
      model,
      maxOutputTokens: 8192,
      system,
      prompt,
      providerOptions,
    });
    const summary = extractJson(summaryResult.text, perspectiveSummaryOutputSchema);

    const finalized = finalizePerspectiveSummary(
      {
        strengths: summary.strengths,
        concerns: summary.concerns,
        overallComment: summary.overallComment,
        recommendation: summary.recommendation,
        recommendationReason: summary.recommendationReason,
      },
      {
        ownerName: candidate.name,
        substantiveQuestionCount: answeredIds.length,
        assessedDimensionCount: answeredDimensions.size,
        configuredDimensionCount: dimensions.length,
      },
    );

    const questionEvaluations: QuestionEvaluation[] = latestQuestions.map((question) => {
      const evaluation = draftById.get(question.id ?? '');
      return {
        questionId: question.id ?? '',
        question: question.question,
        answerSummary: evaluation?.answerSummary ?? '',
        answered: Boolean(evaluation?.answered),
        answer: question.answer ?? '',
        tier: evaluation?.tier,
        score: evaluation?.answered ? (question.score ?? evaluation?.score ?? 0) : 0,
        highlights: evaluation?.highlights ?? [],
        weaknesses: evaluation?.weaknesses ?? [],
      };
    });

    const evaluation = await perspectiveRepository.upsertEvaluation({
      candidateId: id,
      overallScore,
      dimensionScores,
      questionEvaluations,
      recommendation: finalized.recommendation,
      recommendationReason: finalized.recommendationReason,
      strengths: finalized.strengths,
      concerns: finalized.concerns,
      overallComment: finalized.overallComment,
      status: 'complete',
    });

    await perspectiveRepository.updateCandidate(id, { status: 'evaluated' });

    return NextResponse.json({
      status: 'complete',
      evaluated: pool.length,
      total: pool.length,
      evaluation,
      roleFamilyKey: coordinates.roleFamilyKey,
    });
  } catch (error) {
    if (error instanceof AIConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[perspective] evaluation failed:', error);
    return NextResponse.json({ error: 'Failed to generate evaluation' }, { status: 500 });
  }
}
