import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { dbReady } from '@/lib/db';
import { isReservedInterviewSegment } from '@/lib/interview/constants';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id } = await params;
  // `/interview/perspective` 等静态段名不能被当成场次 id
  if (isReservedInterviewSegment(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const session = await interviewRepository.findSession(id);
  if (!session || session.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rounds = await interviewRepository.findRoundsBySessionId(id);
  const report = await interviewRepository.findReportBySessionId(id);

  // Include messages and questions for each round (needed for resume/history and for
  // deciding whether the session still needs its question plan generated).
  const roundsWithMessages = await Promise.all(
    rounds.map(async (round: any) => {
      const [messages, questions] = await Promise.all([
        interviewRepository.findMessagesByRoundId(round.id),
        interviewRepository.findQuestionsByRoundId(round.id),
      ]);
      return { ...round, messages, questions };
    })
  );

  return NextResponse.json({ session, rounds: roundsWithMessages, report });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id } = await params;
  // `/interview/perspective` 等静态段名不能被当成场次 id
  if (isReservedInterviewSegment(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const session = await interviewRepository.findSession(id);
  if (!session || session.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { status } = await request.json();
  if (status) {
    await interviewRepository.updateSessionStatus(id, status);
  }

  const updated = await interviewRepository.findSession(id);
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await dbReady;
  const { id } = await params;
  // `/interview/perspective` 等静态段名不能被当成场次 id
  if (isReservedInterviewSegment(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const session = await interviewRepository.findSession(id);
  if (!session || session.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await interviewRepository.deleteSession(id);
  return new Response(null, { status: 204 });
}
