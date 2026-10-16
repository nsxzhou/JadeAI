import { NextRequest, NextResponse } from 'next/server';
import { getModel, extractAIConfig, getJsonProviderOptions, AIConfigError } from '@/lib/ai/provider';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { planSessionQuestions } from '@/lib/ai/interview-blueprint';
import { sessionDimensions } from '@/lib/interview/session-dimensions';
import { planQuestionCounts, splitQuestionCountAcrossRounds } from '@/lib/interview-core/dimension';
import { normalizePrimaryStack, normalizeRoleFamily } from '@/lib/interview-core/role-family';
import { questionToRow } from '@/lib/interview-core/legacy-questions';
import { candidateQuestionsSlot } from '@/lib/interview-core/reversal';
import { QUESTION_COUNT_PRESETS, type QuestionCountPreset } from '@/lib/interview-core/types';
import { isReservedInterviewSegment } from '@/lib/interview/constants';
import { rejectedQuestionEdits } from '@/lib/interview/question-edit';
import { dbReady } from '@/lib/db';

export const maxDuration = 300;

const PLACEHOLDER_RESUME =
  '(No resume provided. Do not invent any resume facts and do not create resume-sourced slots.)';

/**
 * 为一场模拟面试出题。
 *
 * 幂等：整场题目已经存在时直接返回，不重新生成、不覆盖。
 * 失败语义：蓝图校验或某一路生成失败就整次作废，不落任何题目。
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
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const session = await interviewRepository.findSession(sessionId);
    if (!session || session.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rounds = await interviewRepository.findRoundsBySessionId(sessionId);
    if (rounds.length === 0) {
      return NextResponse.json({ error: 'Session has no rounds' }, { status: 400 });
    }

    const existing = await interviewRepository.findQuestionsBySessionId(sessionId);
    if (existing.length > 0) {
      return NextResponse.json({ questions: existing, reused: true });
    }

    const body = await request.json().catch(() => ({}));
    const { model: modelId, locale = 'zh' } = body as { model?: string; locale?: string };

    let resumeText = PLACEHOLDER_RESUME;
    if (session.resumeId) {
      const resume = await resumeRepository.findById(session.resumeId as string);
      if (resume?.sections) resumeText = JSON.stringify(resume.sections);
    }

    const roleFamily = normalizeRoleFamily(session.roleFamilyKey);
    const primaryStack = normalizePrimaryStack(session.primaryStack);
    const preset = (session.questionCountPreset ?? 'standard') as QuestionCountPreset;
    const totalQuestions = QUESTION_COUNT_PRESETS[preset] ?? QUESTION_COUNT_PRESETS.standard;

    const dimensions = await sessionDimensions(locale, roleFamily, primaryStack);
    const questionCounts = planQuestionCounts({
      general: dimensions.filter((dimension) => dimension.layer === 'general'),
      family: dimensions.filter((dimension) => dimension.layer === 'family'),
      total: totalQuestions,
    });

    const aiConfig = extractAIConfig(request);
    const model = getModel(aiConfig, modelId);

    const { questions } = await planSessionQuestions({
      model,
      providerOptions: getJsonProviderOptions(aiConfig),
      dimensions,
      questionCounts,
      jobTitle: session.jobTitle || 'Interview',
      jobDescription: session.jobDescription,
      resumeText,
      roleFamily,
      primaryStack,
    });

    // 按轮次切片：生成完才知道题数，所以 maxQuestions 在这里回写。
    const perRound = splitQuestionCountAcrossRounds(questions.length, rounds.length);
    const rows = [];
    let cursor = 0;
    for (const [index, round] of rounds.entries()) {
      const count = perRound[index];
      for (let order = 0; order < count; order += 1) {
        rows.push(questionToRow(questions[cursor], { roundId: round.id }, order));
        cursor += 1;
      }
      await interviewRepository.updateRoundMaxQuestions(round.id, count);
    }

    // 反问环节固定在最后：它在预设题数之外，计入通用层的沟通表达。
    const lastRound = rounds[rounds.length - 1];
    const reversal = candidateQuestionsSlot(locale);
    rows.push(questionToRow(reversal, { roundId: lastRound.id }, perRound[rounds.length - 1]));
    await interviewRepository.updateRoundMaxQuestions(
      lastRound.id,
      perRound[rounds.length - 1] + 1,
    );

    await interviewRepository.insertQuestions(rows);

    const saved = await interviewRepository.findQuestionsBySessionId(sessionId);
    return NextResponse.json({ questions: saved, reused: false });
  } catch (error) {
    if (error instanceof AIConfigError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('POST /api/interview/[id]/questions error:', error);
    return NextResponse.json({ error: 'Failed to plan interview questions' }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id: sessionId } = await params;
  if (isReservedInterviewSegment(sessionId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await interviewRepository.findSession(sessionId);
  if (!session || session.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const questions = await interviewRepository.findQuestionsBySessionId(sessionId);
  return NextResponse.json({ questions });
}

/**
 * 提交即定：已经提交的回答不可回改（规则见 `@/lib/interview/question-edit`）。
 * 想改答案只能重练。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id: sessionId } = await params;
  if (isReservedInterviewSegment(sessionId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await interviewRepository.findSession(sessionId);
  if (!session || session.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const { questionId, ...changes } = body as Record<string, unknown>;
  if (typeof questionId !== 'string' || !questionId) {
    return NextResponse.json({ error: 'questionId required' }, { status: 400 });
  }

  const illegal = rejectedQuestionEdits(changes);
  if (illegal.length > 0) {
    return NextResponse.json(
      { error: `Submitted answers are immutable; only markedWeak can be changed (rejected: ${illegal.join(', ')})` },
      { status: 400 },
    );
  }

  // 只能改本场次里的题
  const owned = await interviewRepository.findQuestionsBySessionId(sessionId);
  if (!owned.some((question: { id: string }) => question.id === questionId)) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 });
  }

  await interviewRepository.updateQuestion(questionId, { markedWeak: Boolean(changes.markedWeak) });
  return NextResponse.json({ success: true });
}
