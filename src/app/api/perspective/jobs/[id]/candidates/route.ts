import { NextRequest, NextResponse } from 'next/server';
import { perspectiveRepository } from '@/lib/db/repositories/perspective.repository';
import { createCandidateInputSchema } from '@/lib/ai/perspective-schema';
import { requireOwnedJob } from '@/lib/perspective/access';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireOwnedJob(request, id);
  if ('error' in access) return access.error;

  const body = await request.json();
  const parsed = createCandidateInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const candidate = await perspectiveRepository.createCandidate({
    jobId: id,
    name: parsed.data.name,
  });
  return NextResponse.json({ candidate }, { status: 201 });
}
