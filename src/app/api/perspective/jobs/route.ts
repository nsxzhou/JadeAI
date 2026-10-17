import { NextRequest, NextResponse } from 'next/server';
import { perspectiveRepository } from '@/lib/db/repositories/perspective.repository';
import { createJobInputSchema } from '@/lib/ai/perspective-schema';
import { requireUser } from '@/lib/perspective/access';
import { aggregateJobStats } from '@/lib/perspective/job-stats';
import { totalQuestions, validateJobDimensions, validateQuestionCounts } from '@/lib/interview-core/dimension';

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('error' in auth) return auth.error;

  const [jobs, statRows] = await Promise.all([
    perspectiveRepository.findJobsByUserId(auth.user.id),
    perspectiveRepository.findCandidateStatsByUserId(auth.user.id),
  ]);
  // 岗位卡片要显示候选人数/已面/通过，按 jobId 聚合后一起返回
  return NextResponse.json({ jobs, stats: aggregateJobStats(statRows) });
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if ('error' in auth) return auth.error;

  const body = await request.json();
  const parsed = createJobInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { dimensions, questionCounts } = parsed.data;
  const errors = [
    ...validateJobDimensions(dimensions),
    ...validateQuestionCounts(dimensions, questionCounts),
  ];
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Invalid input', details: errors }, { status: 400 });
  }

  const job = await perspectiveRepository.createJob({
    userId: auth.user.id,
    ...parsed.data,
    // 总题数是派生值：逐维度题数才是权威。
    questionCount: totalQuestions(questionCounts),
  });
  return NextResponse.json({ job }, { status: 201 });
}
