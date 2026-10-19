import { NextRequest } from 'next/server';
import { streamText, convertToModelMessages } from 'ai';
import { getModel, extractAIConfig, AIConfigError } from '@/lib/ai/provider';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { buildInterviewSystemPrompt, type InterviewSlotPrompt } from '@/lib/ai/interview-prompts';
import { planInterviewTurn, type CandidateTurnKind } from '@/lib/interview-core/turn';
import type { QuestionStatus } from '@/lib/interview-core/types';
import { HINT_MESSAGE, INIT_TRIGGER, SKIP_MESSAGE, TIMEOUT_MESSAGE } from '@/lib/interview/constants';
import { QUESTION_TIME_LIMIT_SEC } from '@/lib/interview-core/types';
import { elapsedSec } from '@/lib/interview-core/timing';
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
  // 超时不是候选人写的，但要走同一条推进路径，且必须把已写内容留下。
  if (content.trim() === TIMEOUT_MESSAGE) return 'timeout';
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

    // 暂停中的面试不接受任何对话：前端会把输入区换成暂停面板，
    // 这里再兜一层，防止旧标签页或网络重试在暂停期间偷偷推进题目。
    if (session.status === 'completed') {
      return new Response(JSON.stringify({ error: 'Session already completed', code: 'SESSION_COMPLETED' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (session.status === 'paused') {
      return new Response(JSON.stringify({ error: 'Session is paused', code: 'SESSION_PAUSED' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { messages, roundId, model: modelId, locale = 'zh', timedOut: timedOutFlag = false } = await request.json();

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
    const isTimeoutMarker = incomingText.trim() === TIMEOUT_MESSAGE;
    const hasCandidateMessage = Boolean(incomingText) && !isInitTrigger;
    // 每题限时为 null = 不限时：此时不存在「超时」这回事，客户端也不会发这个标记。
    // 兜底防住旧标签页或手动请求，避免把一次正常回答记成 timed_out。
    const questionTimeLimitSec =
      session.questionTimeLimitSec === undefined
        ? QUESTION_TIME_LIMIT_SEC
        : (session.questionTimeLimitSec as number | null);
    // 超时可以由客户端显式声明（带着已写内容提交），也可以是超时标记本身。
    const isTimeoutTurn =
      questionTimeLimitSec !== null && (Boolean(timedOutFlag) || isTimeoutMarker);
    const classifiedTurn = classifyCandidateTurn(incomingText);
    const turnKind: CandidateTurnKind = hasCandidateMessage
      ? (isTimeoutTurn
        ? 'timeout'
        // 不限时时超时标记只是历史遗留，按普通回答处理
        : classifiedTurn === 'timeout'
          ? 'answer'
          : classifiedTurn)
      : 'none';

    const plan = planInterviewTurn({
      questions: questionStates,
      currentQuestionId: (session.currentQuestionId as string | null) ?? null,
      candidateTurn: turnKind,
    });

    const roundMessages = hasCandidateMessage
      ? await interviewRepository.findMessagesByRoundId(roundId)
      : [];

    // 候选人的回答（或跳过）落库，并挂到它对应的那道题上——报告追溯到这一行。
    let candidateMessageId: string | null = null;
    if (hasCandidateMessage) {
      // 超时标记本身不是回答内容：留一行可追溯的消息，但不写成答案。
      const saved = await interviewRepository.addMessage({
        roundId,
        role: 'candidate',
        content: incomingText,
        questionId: plan.answeringQuestionId,
        metadata: isTimeoutTurn ? { timedOut: true } : undefined,
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
      if (plan.answeringQuestionId && turnKind === 'timeout') {
        // 超时按本题真实用时记账（上限 180 秒）。已经写下的内容要留下——绝不丢答案，
        // 所以带着内容提交时照样写进 answer，只是状态标成 timed_out。
        const askedAt = roundMessages
          .filter((message: { questionId?: string | null; role?: string; createdAt?: Date | string }) =>
            message.questionId === plan.answeringQuestionId && message.role === 'interviewer')
          .map((message: { createdAt?: Date | string }) => new Date(message.createdAt ?? Date.now()).getTime())
          .sort((left: number, right: number) => left - right)[0];
        await interviewRepository.updateQuestion(plan.answeringQuestionId, {
          ...(isTimeoutMarker ? {} : { answer: incomingText }),
          status: 'timed_out',
          timedOut: true,
          timeSpentSec: elapsedSec(askedAt ?? null, Date.now(), questionTimeLimitSec),
        });
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
      stressLevel: (session.stressLevel as string | null) ?? 'gentle',
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
