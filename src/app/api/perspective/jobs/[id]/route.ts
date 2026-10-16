import { NextRequest, NextResponse } from 'next/server';
import { perspectiveRepository } from '@/lib/db/repositories/perspective.repository';
import { updateJobInputSchema } from '@/lib/ai/perspective-schema';
import { requireOwnedJob } from '@/lib/perspective/access';

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

  const job = await perspectiveRepository.updateJob(id, parsed.data);
  return NextResponse.json({ job });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireOwnedJob(request, id);
  if ('error' in access) return access.error;

  await perspectiveRepository.deleteJob(id);
  return NextResponse.json({ success: true });
}
