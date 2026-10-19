import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { getModel, extractAIConfig } from '@/lib/ai/provider';
import { resolveRoleFamily, selectRoleFamily } from '@/lib/interview-core/role-family';
import { splitQuestionCountAcrossRounds } from '@/lib/interview-core/dimension';
import {
  QUESTION_COUNT_PRESETS,
  sessionTimeLimitSec,
  type PrimaryStack,
  type QuestionCountPreset,
  type RoleFamilyKey,
  type StressLevel,
} from '@/lib/interview-core/types';
import { normalizeQuestionTimeLimitSec } from '@/lib/interview-core/timing';
import { dbReady } from '@/lib/db';

const PRESETS = Object.keys(QUESTION_COUNT_PRESETS) as QuestionCountPreset[];
const STRESS_LEVELS: StressLevel[] = ['gentle', 'standard', 'sharp'];

export async function GET(request: NextRequest) {
  await dbReady;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const sessions = await interviewRepository.findSessionSummariesByUserId(user.id);
  return NextResponse.json(sessions);
}

export async function POST(request: NextRequest) {
  await dbReady;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const body = await request.json();
  const {
    jobDescription,
    jobTitle,
    resumeId,
    interviewers,
    questionCountPreset,
    stressLevel,
    roleFamilyKey,
    questionTimeLimitSec,
  } = body;

  if (!jobDescription || !jobTitle || !interviewers?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const preset: QuestionCountPreset = PRESETS.includes(questionCountPreset)
    ? questionCountPreset
    : 'standard';
  const stress: StressLevel = STRESS_LEVELS.includes(stressLevel) ? stressLevel : 'gentle';
  const totalQuestions = QUESTION_COUNT_PRESETS[preset];
  const questionTime = normalizeQuestionTimeLimitSec(questionTimeLimitSec);

  // 岗位族：用户给了就用，否则让模型从静态清单里选；模型不可用就回落关键词判定。
  let roleFamily: RoleFamilyKey;
  let primaryStack: PrimaryStack;
  if (roleFamilyKey) {
    ({ roleFamily, primaryStack } = resolveRoleFamily({ roleFamilyKey, jobTitle, jobDescription }));
  } else {
    let selected: { roleFamily: RoleFamilyKey; primaryStack: PrimaryStack } | null = null;
    try {
      selected = await selectRoleFamily({
        jobTitle,
        jobDescription,
        model: getModel(extractAIConfig(request)),
      });
    } catch {
      // 没配 API key / 模型不可用：静态判定兜底，不能让建会话失败。
      selected = null;
    }
    ({ roleFamily, primaryStack } = selected ?? resolveRoleFamily({ jobTitle, jobDescription }));
  }

  const session = await interviewRepository.createSession({
    userId: user.id,
    resumeId: resumeId || undefined,
    jobDescription,
    jobTitle,
    selectedInterviewers: interviewers,
    roleFamilyKey: roleFamily,
    primaryStack,
    questionCountPreset: preset,
    stressLevel: stress,
    questionTimeLimitSec: questionTime,
    totalTimeLimitSec: sessionTimeLimitSec(totalQuestions, questionTime),
    startedAt: new Date(),
  });

  // 题目在生成之后才存在，先按平均切片把各轮上限撑起来；生成完会按实际题数回写。
  const perRound = splitQuestionCountAcrossRounds(totalQuestions, interviewers.length);
  for (let i = 0; i < interviewers.length; i += 1) {
    await interviewRepository.createRound({
      sessionId: session!.id,
      interviewerType: interviewers[i].type,
      interviewerConfig: interviewers[i],
      sortOrder: i,
      maxQuestions: perRound[i],
    });
  }

  const rounds = await interviewRepository.findRoundsBySessionId(session!.id);
  return NextResponse.json({ session, rounds }, { status: 201 });
}
