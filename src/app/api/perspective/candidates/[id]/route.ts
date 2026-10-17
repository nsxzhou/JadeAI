import { NextRequest, NextResponse } from 'next/server';
import { perspectiveRepository } from '@/lib/db/repositories/perspective.repository';
import { updateCandidateInputSchema } from '@/lib/ai/perspective-schema';
import { requireOwnedCandidate } from '@/lib/perspective/access';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireOwnedCandidate(request, id);
  if ('error' in access) return access.error;

  const evaluation = await perspectiveRepository.findEvaluation(id);
  // partial = 逐题段还没跑完：报告页要显示进度并从断点继续，不能当成已有报告。
  return NextResponse.json({
    candidate: access.candidate,
    job: access.job,
    evaluation,
    evaluationStatus: evaluation?.status ?? 'none',
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireOwnedCandidate(request, id);
  if ('error' in access) return access.error;

  const body = await request.json();
  const parsed = updateCandidateInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const candidate = await perspectiveRepository.updateCandidate(id, parsed.data as any);
  return NextResponse.json({ candidate });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireOwnedCandidate(request, id);
  if ('error' in access) return access.error;

  await perspectiveRepository.deleteCandidate(id);
  return NextResponse.json({ success: true });
}
