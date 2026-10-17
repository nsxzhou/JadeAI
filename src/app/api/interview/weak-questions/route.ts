import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { groupWeakQuestions } from '@/lib/interview-core/weak-questions';
import { rowToQuestion } from '@/lib/interview-core/legacy-questions';
import { RETRY_QUESTION_LIMIT } from '@/lib/interview-core/types';
import { dbReady } from '@/lib/db';

/**
 * 错题本：跨场次保留题干与考察意图，并给出同一道题的历次回答。
 *
 * 判定在服务端（单题分 < 60 或用户手动标记），不在模型手里——相对阈值会跟着你一起
 * 退步，纯 AI 判定会漂。
 */
export async function GET(request: NextRequest) {
  await dbReady;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await interviewRepository.findQuestionsByUserId(user.id);

  // 两种玩法一起看：模拟面试里答砸的题、面试官视角标出来的弱项，是同一件事。
  const entries = groupWeakQuestions(
    rows.map((row) => ({
      question: rowToQuestion(row.question),
      sessionId: row.sessionId,
      jobTitle: row.jobTitle,
      source: row.source,
      createdAt: row.createdAt,
    })),
  );

  return NextResponse.json({
    entries,
    retryLimit: RETRY_QUESTION_LIMIT,
  });
}
