import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { getModel, extractAIConfig, getJsonProviderOptions, AIConfigError } from '@/lib/ai/provider';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { roundEvaluationSchema, sessionSummarySchema } from '@/lib/ai/interview-report-schema';
import { buildRoundEvaluationPrompt, buildSessionSummaryPrompt } from '@/lib/ai/interview-prompts';
import { extractJson } from '@/lib/ai/extract-json';
import { assembleRoundEvaluation, buildSessionReportNumbers } from '@/lib/interview-core/report';
import { sessionDimensions } from '@/lib/interview/session-dimensions';
import { normalizePrimaryStack, normalizeRoleFamily } from '@/lib/interview-core/role-family';
import { rowToQuestion } from '@/lib/interview-core/legacy-questions';
import type { InterviewMessageMetadata } from '@/types/interview';
import type { RoundEvaluation } from '@/lib/interview-core/types';
import { isReservedInterviewSegment } from '@/lib/interview/constants';
import { dbReady } from '@/lib/db';

export const maxDuration = 300;

/** 从该轮消息里取控制标记，按题目 id 归类。 */
function flagsByQuestion(messages: Array<{ questionId?: string | null; metadata?: unknown }>) {
  const flags: Record<string, { marked?: boolean; hinted?: boolean }> = {};
  for (const message of messages) {
    const metadata = (message.metadata ?? {}) as InterviewMessageMetadata;
    if (!message.questionId) continue;
    if (metadata.marked || metadata.hinted) {
      flags[message.questionId] = { marked: metadata.marked, hinted: metadata.hinted };
    }
  }
  return flags;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id: sessionId } = await params;
  if (isReservedInterviewSegment(sessionId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const session = await interviewRepository.findSession(sessionId);
  if (!session || session.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const report = await interviewRepository.findReportBySessionId(sessionId);
  if (report) return NextResponse.json({ status: 'complete', report });

  const rounds = await interviewRepository.findRoundsBySessionId(sessionId);
  const pendingRoundIds: string[] = [];
  for (const round of rounds) {
    const questions = await interviewRepository.findQuestionsByRoundId(round.id);
    const answered = questions.some(
      (question: Record<string, unknown>) => String(question.answer ?? '').trim() && question.status !== 'skipped',
    );
    const evaluated = ((round.summary as { questions?: unknown[] } | null)?.questions?.length ?? 0) > 0;
    if (answered && !evaluated) pendingRoundIds.push(String(round.id));
  }

  return NextResponse.json({
    status: 'partial',
    // 明示可重试的那一轮：客户端拿它做单轮重试，不必重跑整场。
    failingRoundId: pendingRoundIds[0] ?? null,
    pendingRoundIds,
    roundCount: rounds.length,
  });
}

/**
 * 两段式生成报告。
 *
 * 1. 逐轮补评估（幂等）：某轮已评估就跳过；单轮失败只返回该轮 id，可单独重试。
 * 2. 全场汇总：输入是各轮已落定的分数与逐题记要，**不重读全文**。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbReady;
    const { id: sessionId } = await params;
    if (isReservedInterviewSegment(sessionId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) return new Response('Unauthorized', { status: 401 });

    const session = await interviewRepository.findSession(sessionId);
    if (!session || session.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const existing = await interviewRepository.findReportBySessionId(sessionId);
    if (existing) return NextResponse.json({ status: 'complete', report: existing });

    const body = await request.json().catch(() => ({}));
    const { model: modelId, locale = 'zh', roundId } = body as {
      model?: string;
      locale?: string;
      roundId?: string;
    };

    const aiConfig = extractAIConfig(request);
    const model = getModel(aiConfig, modelId);
    const providerOptions = getJsonProviderOptions(aiConfig);

    const allRounds = await interviewRepository.findRoundsBySessionId(sessionId);
    const targets = roundId ? allRounds.filter((round: { id: string }) => round.id === roundId) : allRounds;
    if (targets.length === 0) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    // ── 第一段：逐轮评估 ───────────────────────────────────────────────────
    for (const round of targets) {
      const summary = (round.summary ?? null) as { questions?: unknown[] } | null;
      if ((summary?.questions?.length ?? 0) > 0) continue; // 幂等

      const questions = await interviewRepository.findQuestionsByRoundId(round.id);
      if (questions.length === 0) {
        await interviewRepository.setRoundSummary(round.id, { score: null, feedback: '', questions: [] });
        continue;
      }

      const config = (round.interviewerConfig ?? {}) as { name?: string };
      const interviewerName = config.name ?? round.interviewerType;
      const messages = await interviewRepository.findMessagesByRoundId(round.id);

      const { system, prompt } = buildRoundEvaluationPrompt({
        jobTitle: session.jobTitle || 'Interview',
        jobDescription: session.jobDescription,
        interviewerName,
        interviewerType: round.interviewerType,
        questions: questions.map((question: Record<string, unknown>) => ({
          id: String(question.id),
          question: String(question.question ?? ''),
          intent: String(question.intent ?? ''),
          rubric: (question.rubric ?? { excellent: '', pass: '', fail: '' }) as {
            excellent: string;
            pass: string;
            fail: string;
          },
          answer: String(question.answer ?? ''),
          skipped: question.status === 'skipped',
        })),
        locale,
      });

      let parsed;
      try {
        const result = await generateText({
          model,
          maxOutputTokens: 8192,
          system,
          prompt,
          providerOptions,
        });
        parsed = extractJson(result.text, roundEvaluationSchema);
      } catch (error) {
        console.error(`report: round ${round.id} evaluation failed`, error);
        return NextResponse.json({
          status: 'partial',
          failingRoundId: round.id,
          error: '这一轮的评估生成失败，可单独重试。',
        });
      }

      let assembled;
      try {
        assembled = assembleRoundEvaluation({
          roundId: round.id,
          interviewerType: round.interviewerType,
          interviewerName,
          questions: questions.map((question: Record<string, unknown>) => rowToQuestion(question)),
          aiEvaluations: parsed.questions,
          flags: flagsByQuestion(messages as Array<{ questionId?: string | null; metadata?: unknown }>),
          feedback: parsed.feedback,
        });
      } catch (error) {
        console.error(`report: round ${round.id} assembly failed`, error);
        return NextResponse.json({
          status: 'partial',
          failingRoundId: round.id,
          error: '这一轮的评估不完整，可单独重试。',
        });
      }

      // 单题分与档位落库——报告里每个数字都由此可追溯回原始回答。
      for (const evaluation of assembled.questions) {
        if (!evaluation.questionId || !evaluation.answered) continue;
        await interviewRepository.updateQuestion(evaluation.questionId, {
          tier: evaluation.tier ?? null,
          score: evaluation.score ?? null,
        });
      }

      await interviewRepository.setRoundSummary(round.id, {
        score: assembled.score,
        feedback: assembled.feedback,
        questions: assembled.questions,
      });
    }

    // ── 第二段：全场汇总（不重读全文） ──────────────────────────────────────
    const roundsAfter = await interviewRepository.findRoundsBySessionId(sessionId);
    const questionRows = await interviewRepository.findQuestionsBySessionId(sessionId);
    const questions = questionRows.map((row: Record<string, unknown>) => rowToQuestion(row));

    const roleFamily = normalizeRoleFamily(session.roleFamilyKey);
    const primaryStack = normalizePrimaryStack(session.primaryStack);
    const dimensions = await sessionDimensions(locale, roleFamily, primaryStack);

    const { overallScore, dimensionScores } = buildSessionReportNumbers(dimensions, questions);

    const roundSummaries = roundsAfter.map((round: Record<string, unknown>) => {
      const summary = (round.summary ?? {}) as {
        score?: number | null;
        feedback?: string;
        questions?: Array<{ question?: string; score?: number; answerSummary?: string; weaknesses?: string[] }>;
      };
      const config = (round.interviewerConfig ?? {}) as { name?: string };
      return {
        interviewerName: config.name ?? String(round.interviewerType ?? ''),
        score: summary.score ?? null,
        feedback: summary.feedback ?? '',
        questions: (summary.questions ?? []).map((question) => ({
          question: question.question ?? '',
          score: question.score ?? 0,
          answerSummary: question.answerSummary ?? '',
          weaknesses: question.weaknesses ?? [],
        })),
      };
    });

    const summaryPrompt = buildSessionSummaryPrompt({
      jobTitle: session.jobTitle || 'Interview',
      jobDescription: session.jobDescription,
      roundSummaries,
      dimensionScores: dimensionScores.map((dimension) => ({
        label: dimension.label,
        score: dimension.score,
        weight: dimension.weight,
      })),
      overallScore,
      locale,
    });

    const summaryResult = await generateText({
      model,
      maxOutputTokens: 8192,
      system: summaryPrompt.system,
      prompt: summaryPrompt.prompt,
      providerOptions,
    });
    const summary = extractJson(summaryResult.text, sessionSummarySchema);

    const roundEvaluations: RoundEvaluation[] = roundsAfter.map((round: Record<string, unknown>) => {
      const summary = (round.summary ?? {}) as {
        score?: number | null;
        feedback?: string;
        questions?: RoundEvaluation['questions'];
      };
      const config = (round.interviewerConfig ?? {}) as { name?: string };
      return {
        roundId: String(round.id),
        interviewerType: String(round.interviewerType ?? ''),
        interviewerName: config.name ?? String(round.interviewerType ?? ''),
        score: summary.score ?? 0,
        feedback: summary.feedback ?? '',
        questions: summary.questions ?? [],
      };
    });

    const saved = await interviewRepository.createReport({
      sessionId,
      overallScore,
      dimensionScores,
      roundEvaluations,
      overallFeedback: summary.overallFeedback,
      improvementPlan: summary.improvementPlan,
    });

    return NextResponse.json({ status: 'complete', report: saved });
  } catch (error) {
    if (error instanceof AIConfigError) {
      return new Response(JSON.stringify({ error: error.message }), { status: 401 });
    }
    console.error('POST /api/interview/[id]/report error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
