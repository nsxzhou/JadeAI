import { NextRequest } from 'next/server';
import { streamText, convertToModelMessages } from 'ai';
import { getModel, extractAIConfig, AIConfigError } from '@/lib/ai/provider';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { buildInterviewSystemPrompt, type InterviewSlotPrompt } from '@/lib/ai/interview-prompts';
import { planInterviewTurn, type CandidateTurnKind } from '@/lib/interview-core/turn';
import type { QuestionStatus } from '@/lib/interview-core/types';
import { HINT_MESSAGE, INIT_TRIGGER, SKIP_MESSAGE } from '@/lib/interview/constants';
import { dbReady } from '@/lib/db';

/** 一条消息里取出文本内容，兼容 AI SDK 的 parts 与纯 content 两种形态。 */
function messageText(message: {
  content?: unknown;
  parts?: Array<{ type: string; text?: string }>;
}): string {
  const textPart = message.parts?.find((p) => p.type === 'text');
  return textPart?.text || (typeof message.content === 'string' ? message.content : '');
}

/** 候选人这条消息是什么性质：真实回答 / 跳过 / 请求提示 / 开场触发语。 */
function classifyCandidateTurn(content: string): CandidateTurnKind {
  if (content.trim() === HINT_MESSAGE) return 'hint';
  if (content.trim() === SKIP_MESSAGE) return 'skip';
  return 'answer';
}

function slotOf(question: {
  question: string;
  intent: string;
  rubric: unknown;
  followUps: unknown;
}): InterviewSlotPrompt {
  const rubric = (question.rubric ?? {}) as { excellent?: string; pass?: string; fail?: string };
  const followUps = Array.isArray(question.followUps) ? question.followUps : [];
  return {
    question: question.question,
    intent: question.intent,
    rubric: {
      excellent: rubric.excellent ?? '',
      pass: rubric.pass ?? '',
      fail: rubric.fail ?? '',
    },
    followUps: followUps
      .map((followUp) => {
        if (typeof followUp === 'string') return followUp;
        const record = followUp as { question?: unknown };
        return typeof record.question === 'string' ? record.question : '';
      })
      .filter((value) => value.trim().length > 0),
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbReady;
    const { id: sessionId } = await params;
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) return new Response('Unauthorized', { status: 401 });

    const session = await interviewRepository.findSession(sessionId);
    if (!session || session.userId !== user.id) {
      return new Response('Not found', { status: 404 });
    }

    const { messages, roundId, model: modelId, locale = 'zh' } = await request.json();

    const round = await interviewRepository.findRound(roundId);
    if (!round || round.sessionId !== sessionId) {
      return new Response('Round not found', { status: 404 });
    }

    // 本轮已经收尾时不再接受新对话：否则模型继续输出会让题数越过上限。
    if (round.status === 'completed' || round.status === 'skipped') {
      return new Response(JSON.stringify({ error: 'Round already completed' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let resumeContent: string | undefined;
    if (session.resumeId) {
      const resume = await resumeRepository.findById(session.resumeId as string);
      if (resume) {
        resumeContent = JSON.stringify(resume.sections);
      }
    }

    const interviewerConfig = round.interviewerConfig as any;

    // 本轮题目由蓝图定好；对话只决定怎么问。
    const questionRows = await interviewRepository.findQuestionsByRoundId(roundId);
    const questionStates = questionRows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      status: (row.status ?? 'pending') as QuestionStatus,
    }));

    const incoming = messages.length > 0 ? messages[messages.length - 1] : null;
    const incomingText = incoming?.role === 'user' ? messageText(incoming) : '';
    const isInitTrigger = incomingText === INIT_TRIGGER;
    const hasCandidateMessage = Boolean(incomingText) && !isInitTrigger;
    const turnKind: CandidateTurnKind = hasCandidateMessage ? classifyCandidateTurn(incomingText) : 'none';

    const plan = planInterviewTurn({
      questions: questionStates,
      currentQuestionId: (session.currentQuestionId as string | null) ?? null,
      candidateTurn: turnKind,
    });

    // 候选人的回答（或跳过）落库，并挂到它对应的那道题上——报告追溯到这一行。
    let candidateMessageId: string | null = null;
    if (hasCandidateMessage) {
      const saved = await interviewRepository.addMessage({
        roundId,
        role: 'candidate',
        content: incomingText,
        questionId: plan.answeringQuestionId,
      });
      candidateMessageId = saved?.id ?? null;

      if (plan.answeringQuestionId && turnKind === 'answer') {
        await interviewRepository.updateQuestion(plan.answeringQuestionId, {
          answer: incomingText,
          status: 'answered',
        });
      }
      if (plan.answeringQuestionId && turnKind === 'skip') {
        await interviewRepository.updateQuestion(plan.answeringQuestionId, { status: 'skipped' });
      }
    }

    const askRow = plan.askQuestionId
      ? questionRows.find((row: Record<string, unknown>) => row.id === plan.askQuestionId)
      : null;
    const currentSlot = askRow
      ? slotOf(askRow as { question: string; intent: string; rubric: unknown; followUps: unknown })
      : null;

    const aiConfig = extractAIConfig(request);
    const model = getModel(aiConfig, modelId);
    const modelMessages = await convertToModelMessages(messages);

    if (round.status === 'pending') {
      await interviewRepository.updateRoundStatus(roundId, 'in_progress');
      await interviewRepository.markRoundStarted(roundId);
      await interviewRepository.updateSessionStatus(sessionId, 'in_progress');
    }

    // 没有下一题可问 = 这一轮该收尾了，服务端要求模型写结束标记。
    const isClosingTurn = plan.roundResolved || questionStates.length === 0;

    const systemPrompt = buildInterviewSystemPrompt({
      interviewer: interviewerConfig,
      jobDescription: session.jobDescription,
      resumeContent,
      maxQuestions: round.maxQuestions,
      isFinalQuestion: isClosingTurn,
      currentSlot,
      locale,
    });

    const assistantMessageId = crypto.randomUUID();

    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      onFinish: async ({ text }) => {
        if (!text) return;

        await interviewRepository.addMessage({
          id: assistantMessageId,
          roundId,
          role: 'interviewer',
          content: text,
          questionId: plan.askQuestionId,
        });

        // 这一问已经抛给候选人了，标记为 asked。
        const askQuestionId = plan.askQuestionId;
        if (askQuestionId && askRow && (askRow.status ?? 'pending') === 'pending') {
          await interviewRepository.updateQuestion(askQuestionId, { status: 'asked' });
        }

        const modelCompleted = text.includes('[ROUND_COMPLETE]');
        if (plan.roundResolved || modelCompleted) {
          await interviewRepository.markRoundFinished(roundId);
          await interviewRepository.setSessionCurrentQuestion(sessionId, null);

          const rounds = await interviewRepository.findRoundsBySessionId(sessionId);
          const currentIndex = rounds.findIndex((r: { id: string }) => r.id === roundId);
          const nextRound = rounds[currentIndex + 1];

          if (nextRound) {
            await interviewRepository.updateSessionRound(sessionId, currentIndex + 1);
          } else {
            await interviewRepository.updateSessionStatus(sessionId, 'completed');
          }
        } else {
          await interviewRepository.setSessionCurrentQuestion(sessionId, plan.askQuestionId);
        }
      },
    });

    return result.toUIMessageStreamResponse({
      generateMessageId: () => assistantMessageId,
      messageMetadata: () => ({
        assistantMessageId,
        candidateMessageId,
        questionId: plan.askQuestionId,
        roundComplete: isClosingTurn,
      }),
    });
  } catch (error) {
    if (error instanceof AIConfigError) {
      return new Response(JSON.stringify({ error: error.message }), { status: 401 });
    }
    console.error('POST /api/interview/[id]/chat error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
