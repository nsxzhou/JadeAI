import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { perspectiveRepository } from '@/lib/db/repositories/perspective.repository';
import { buildProfile } from '@/lib/interview-core/profile';
import { normalizeRoleFamily } from '@/lib/interview-core/role-family';
import type { DimensionScore } from '@/lib/interview-core/types';
import { dbReady } from '@/lib/db';

/**
 * 能力画像：两层坐标上的跨场次累积。
 *
 * 两个模式共用同一套坐标，所以一起画：模拟面试是「我练的」，面试官视角是
 * 「我推演会被怎么判的」，对求职者是同一条进步曲线。每个点带来源标签。
 *
 * 只吃坐标可识别的报告——老报告的坐标不固定，画在一条线上斜率没有意义，
 * 由 `buildProfile` 直接排除。
 */
export async function GET(request: NextRequest) {
  await dbReady;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [reports, perspectiveEvaluations] = await Promise.all([
    interviewRepository.findReportsByUserId(user.id),
    perspectiveRepository.findEvaluationProfilesByUserId(user.id),
  ]);

  const profile = buildProfile([
    ...reports.map(({ report, session }: {
      report: { dimensionScores: unknown; createdAt?: Date | string };
      session: { id: string; createdAt: Date | string; roleFamilyKey?: string | null };
    }) => ({
      sessionId: session.id,
      createdAt: report.createdAt ?? session.createdAt,
      roleFamilyKey: session.roleFamilyKey ? normalizeRoleFamily(session.roleFamilyKey) : null,
      dimensionScores: (report.dimensionScores ?? []) as DimensionScore[],
      source: 'mock' as const,
    })),
    ...perspectiveEvaluations.map((entry) => ({
      sessionId: entry.candidateId,
      createdAt: entry.createdAt,
      roleFamilyKey: entry.roleFamilyKey ? normalizeRoleFamily(entry.roleFamilyKey) : null,
      dimensionScores: entry.dimensionScores,
      source: 'perspective' as const,
    })),
  ]);

  return NextResponse.json({ profile });
}
