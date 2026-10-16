import { NextRequest } from 'next/server';
import { streamText, convertToModelMessages } from 'ai';
import { getModel, extractAIConfig, AIConfigError } from '@/lib/ai/provider';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { buildInterviewSystemPrompt } from '@/lib/ai/interview-prompts';
import { dbReady } from '@/lib/db';
import { INIT_TRIGGER } from '@/lib/interview/constants';

/** 一条消息里取出文本内容，兼容 AI SDK 的 parts 与纯 content 两种形态。 */
function messageText(message: {
  content?: unknown;
  parts?: Array<{ type: string; text?: string }>;
}): string {
  const textPart = message.parts?.find((p) => p.type === 'text');
  return textPart?.text || (typeof message.content === 'string' ? message.content : '');
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

    // 服务端生成候选人消息 id 并落库，再把 id 通过流回传；前端不再自造 UUID。
    let candidateMessageId: string | null = null;
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        const content = messageText(lastMessage);
        // 开场触发语不是候选人的回答，不落库。
        if (content && content !== INIT_TRIGGER) {
          const saved = await interviewRepository.addMessage({
            roundId,
            role: 'candidate',
            content,
          });
          candidateMessageId = saved?.id ?? null;
        }
      }
    }

    // 面试官消息 id 提前生成，流式响应用同一个 id，落库与前端展示不再各持一份。
    const assistantMessageId = crypto.randomUUID();

    const aiConfig = extractAIConfig(request);
    const model = getModel(aiConfig, modelId);
    const modelMessages = await convertToModelMessages(messages);

    if (round.status === 'pending') {
      await interviewRepository.updateRoundStatus(roundId, 'in_progress');
      await interviewRepository.updateSessionStatus(sessionId, 'in_progress');
    }

    // 这一条就会用满本轮题数，服务端要求模型收尾，不再等它自己决定。
    const isFinalQuestion = round.questionCount + 1 >= round.maxQuestions;

    const systemPrompt = buildInterviewSystemPrompt({
      interviewer: interviewerConfig,
      jobDescription: session.jobDescription,
      resumeContent,
      maxQuestions: round.maxQuestions,
      isFinalQuestion,
      locale,
    });

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
        });

        const count = await interviewRepository.incrementQuestionCount(roundId);
        const modelCompleted = text.includes('[ROUND_COMPLETE]');
        const reachedLimit = count >= round.maxQuestions;

        if (modelCompleted || reachedLimit) {
          await interviewRepository.updateRoundStatus(roundId, 'completed');

          const rounds = await interviewRepository.findRoundsBySessionId(sessionId);
          const currentIndex = rounds.findIndex((r: { id: string }) => r.id === roundId);
          const nextRound = rounds[currentIndex + 1];

          if (nextRound) {
            await interviewRepository.updateSessionRound(sessionId, currentIndex + 1);
          } else {
            await interviewRepository.updateSessionStatus(sessionId, 'completed');
          }
        }
      },
    });

    return result.toUIMessageStreamResponse({
      generateMessageId: () => assistantMessageId,
      messageMetadata: () => ({
        assistantMessageId,
        candidateMessageId,
        roundComplete: isFinalQuestion,
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
