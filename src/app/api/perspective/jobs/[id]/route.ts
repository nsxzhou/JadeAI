import { NextRequest, NextResponse } from 'next/server';
import { perspectiveRepository } from '@/lib/db/repositories/perspective.repository';
import { updateJobInputSchema } from '@/lib/ai/perspective-schema';
import { requireOwnedJob } from '@/lib/perspective/access';
import { parseQuestionCounts } from '@/lib/perspective/job-coordinates';
import { totalQuestions, validateJobDimensions, validateQuestionCounts } from '@/lib/interview-core/dimension';
import type { DimensionConfig } from '@/lib/interview-core/types';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireOwnedJob(request, id);
  if ('error' in access) return access.error;

  const candidates = await perspectiveRepository.findCandidateSummaries(id);
  return NextResponse.json({ job: access.job, candidates });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireOwnedJob(request, id);
  if ('error' in access) return access.error;

  const body = await request.json();
  const parsed = updateJobInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 },
    );
  }

  // 坐标是一个整体：岗位族、语言栈、维度、题数必须一起改。只改其中一项会让库里
  // 的「维度」和「题数」对不上，出题时蓝图校验必然失败。
  const touchesCoordinates = Boolean(
    parsed.data.roleFamilyKey
    || parsed.data.primaryStack
    || parsed.data.dimensions
    || parsed.data.questionCounts,
  );
  const completeCoordinates = Boolean(
    parsed.data.roleFamilyKey
    && parsed.data.primaryStack
    && parsed.data.dimensions
    && parsed.data.questionCounts,
  );
  if (touchesCoordinates && !completeCoordinates) {
    return NextResponse.json(
      { error: 'roleFamilyKey, primaryStack, dimensions and questionCounts must be updated together' },
      { status: 400 },
    );
  }

  // 部分更新：用库里现有的坐标补齐缺席字段再校验，避免「只改标题」被坐标校验挡掉。
  const dimensions = (parsed.data.dimensions
    ?? (access.job.dimensions as DimensionConfig[] | null)
    ?? []) as DimensionConfig[];
  const questionCounts = parsed.data.questionCounts
    ?? parseQuestionCounts(access.job.questionCounts)
    ?? undefined;

  const errors = [
    ...validateJobDimensions(dimensions),
    ...(questionCounts ? validateQuestionCounts(dimensions, questionCounts) : []),
  ];
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Invalid input', details: errors }, { status: 400 });
  }

  const questionCount = questionCounts ? totalQuestions(questionCounts) : access.job.questionCount;
  const job = await perspectiveRepository.updateJob(id, { ...parsed.data, questionCount });
  return NextResponse.json({ job });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireOwnedJob(request, id);
  if ('error' in access) return access.error;

  await perspectiveRepository.deleteJob(id);
  return NextResponse.json({ success: true });
}
