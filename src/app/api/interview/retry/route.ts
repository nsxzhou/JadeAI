import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { getPresetInterviewer } from '@/lib/interview/interviewers';
import { questionToRow, rowToQuestion } from '@/lib/interview-core/legacy-questions';
import { normalizePrimaryStack, normalizeRoleFamily } from '@/lib/interview-core/role-family';
import { RETRY_QUESTION_LIMIT, sessionTimeLimitSec } from '@/lib/interview-core/types';
import { dbReady } from '@/lib/db';

/**
 * 重练：把错题复制进一场新的短面试。
 *
 * 是**复制**不是复用：新题带 `originQuestionId` 指向原题，这样前后两次回答能并排对比。
 * 上限 10 题（RETRY_QUESTION_LIMIT）。
 */
export async function POST(request: NextRequest) {
  await dbReady;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { questionIds, locale = 'zh' } = body as { questionIds?: string[]; locale?: string };
  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    return NextResponse.json({ error: 'questionIds required' }, { status: 400 });
  }

  const rows = await interviewRepository.findQuestionsByUserId(user.id);
  const wanted = new Set(questionIds.slice(0, RETRY_QUESTION_LIMIT));

  // 取每条链最新的一次作答作为复制来源。
  const latestByRoot = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const question = rowToQuestion(row.question);
    if (!question.id) continue;
    const rootId = question.originQuestionId ?? question.id;
    if (!wanted.has(rootId) && !wanted.has(question.id)) continue;
    const existing = latestByRoot.get(rootId);
    if (!existing || row.createdAt >= existing.createdAt) latestByRoot.set(rootId, row);
  }

  const sources = [...latestByRoot.values()].slice(0, RETRY_QUESTION_LIMIT);
  if (sources.length === 0) {
    return NextResponse.json({ error: 'No matching questions' }, { status: 404 });
  }

  // 来源可能是模拟面试，也可能是面试官视角（没有会话）。挑第一个有会话的当元数据来源，
  // 都没有就用题目自带的岗位信息。
  const withSession = sources.find((row) => row.sessionId);
  const sourceSession = withSession?.sessionId
    ? await interviewRepository.findSession(withSession.sessionId)
    : null;
  const sourceRounds = withSession?.sessionId
    ? await interviewRepository.findRoundsBySessionId(withSession.sessionId)
    : [];
  const interviewerConfig = sourceRounds[0]?.interviewerConfig
    ?? getPresetInterviewer('technical', locale === 'en' ? 'en' : 'zh');

  const jobDescription = sourceSession?.jobDescription || sources[0].jobDescription || '';
  const jobTitle = sourceSession?.jobTitle || sources[0].jobTitle || '';
  const roleFamilyKey = sourceSession?.roleFamilyKey ?? sources[0].roleFamilyKey ?? null;
  const primaryStack = sourceSession?.primaryStack ?? sources[0].primaryStack ?? null;

  const total = sources.length;
  const session = await interviewRepository.createSession({
    userId: user.id,
    jobDescription,
    jobTitle: jobTitle ? `重练 · ${jobTitle}` : '错题重练',
    selectedInterviewers: interviewerConfig ? [interviewerConfig] : [],
    roleFamilyKey: normalizeRoleFamily(roleFamilyKey),
    primaryStack: normalizePrimaryStack(primaryStack),
    questionCountPreset: 'short',
    stressLevel: (sourceSession?.stressLevel as never) ?? 'gentle',
    totalTimeLimitSec: sessionTimeLimitSec(total),
    startedAt: new Date(),
  });

  const round = await interviewRepository.createRound({
    sessionId: session!.id,
    interviewerType: interviewerConfig?.type ?? 'technical',
    interviewerConfig: interviewerConfig as never,
    sortOrder: 0,
    maxQuestions: total,
  });

  const copiedRows = sources.map((row, index) => {
    const question = rowToQuestion(row.question);
    const rootId = question.originQuestionId ?? question.id;
    return {
      ...questionToRow({ ...question, originQuestionId: rootId }, { roundId: round!.id }, index),
      // 重练从零开始：不带旧答案、旧分数、旧标记
      answer: '',
      score: null,
      tier: null,
      markedWeak: 0,
      status: 'pending',
      timedOut: 0,
      timeSpentSec: null,
    };
  });
  await interviewRepository.insertQuestions(copiedRows);

  return NextResponse.json({ sessionId: session!.id }, { status: 201 });
}
