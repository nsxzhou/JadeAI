'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { UIMessage } from 'ai';
import { useRouter } from '@/i18n/routing';
import { useInterviewStore } from '@/stores/interview-store';
import type { InterviewMessageMetadata } from '@/types/interview';
import { useInterviewChat } from '@/hooks/use-interview-chat';
import { getAIHeaders, useSettingsStore } from '@/stores/settings-store';
import { INIT_TRIGGER, TIMEOUT_MESSAGE } from '@/lib/interview/constants';
import { isRoundViewOnly } from '@/lib/interview/round-status';
import { ProgressBar } from './progress-bar';
import { InterviewerBanner } from './interviewer-banner';
import { MessageList } from './message-list';
import { MessageInput } from './message-input';
import { useInterviewControls } from './control-bar';
import { RoundTransition } from './round-transition';
import { ThinkingIndicator } from './thinking-indicator';
import { QuestionTimer } from './question-timer';
import type { InterviewerConfig } from '@/types/interview';

/** Convert DB messages to UIMessage format */
function dbMessagesToUIMessages(dbMessages: any[]): UIMessage[] {
  return dbMessages
    .filter((m: any) => m.role !== 'system')
    .map((m: any) => ({
      id: m.id,
      role: m.role === 'interviewer' ? ('assistant' as const) : ('user' as const),
      parts: [{ type: 'text' as const, text: m.content }],
      metadata: (m.metadata ?? {}) as InterviewMessageMetadata,
    }));
}

/** 把 DB 里落库的控制标记搬进 store，刷新后标记仍在。 */
function flagsFromMessages(dbMessages: any[]): Record<string, InterviewMessageMetadata> {
  const flags: Record<string, InterviewMessageMetadata> = {};
  for (const message of dbMessages) {
    const metadata = (message.metadata ?? {}) as InterviewMessageMetadata;
    if (metadata.marked || metadata.hinted || metadata.skipped) {
      flags[message.id] = metadata;
    }
  }
  return flags;
}

interface InterviewRoomProps {
  sessionId: string;
  initialMessages?: UIMessage[];
}

export function InterviewRoom({ sessionId, initialMessages }: InterviewRoomProps) {
  const t = useTranslations('interview.room');
  const locale = useLocale();
  const router = useRouter();
  const { rounds, currentRoundIndex, setCurrentRoundIndex, advanceToNextRound, setIsGeneratingReport, status: sessionStatus, hydrateMessageFlags } =
    useInterviewStore();
  const [showTransition, setShowTransition] = useState(false);
  const [isViewingHistory, setIsViewingHistory] = useState(false);
  const [isGeneratingReport, setIsGeneratingReportLocal] = useState(false);

  const currentRound = rounds[currentRoundIndex];
  const interviewerConfig = currentRound?.interviewerConfig as InterviewerConfig;
  const isRoundDone = isRoundViewOnly(currentRound?.status, sessionStatus);

  const { messages, input, handleInputChange, handleSubmit, isLoading, resetMessages, sendMessage, sendTimeout, setMessages, setInput } =
    useInterviewChat({
      sessionId,
      roundId: currentRound?.id || '',
      selectedModel: useSettingsStore.getState().aiModel,
    });

  // Load initial messages from DB on first render
  const loadedRef = useRef(false);
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0 && !loadedRef.current) {
      loadedRef.current = true;
      setMessages(initialMessages);
    }
  }, [initialMessages, setMessages]);

  // Auto-send trigger to start interview (only if no history and round is active)
  const sentInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      currentRound &&
      messages.length === 0 &&
      !isLoading &&
      !loadedRef.current &&
      !isViewingHistory &&
      !isRoundDone &&
      sentInitRef.current !== currentRound.id
    ) {
      sentInitRef.current = currentRound.id;
      sendMessage({ text: INIT_TRIGGER });
    }
  }, [currentRound?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-set viewing history if round is already done
  useEffect(() => {
    if (currentRound && isRoundDone) {
      setIsViewingHistory(true);
      setShowTransition(false);
      loadedRef.current = true;
    }
  }, [currentRound?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect round completion: the server marks the final question in metadata,
  // and a model-driven finish still shows up as the [ROUND_COMPLETE] marker.
  useEffect(() => {
    if (!messages.length || isLoading || isViewingHistory) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'assistant') return;
    const meta = lastMsg.metadata as InterviewMessageMetadata | undefined;
    const text = lastMsg.parts?.find((p: any) => p.type === 'text');
    if (meta?.roundComplete || (text as any)?.text?.includes('[ROUND_COMPLETE]')) {
      setShowTransition(true);
    }
  }, [messages, isLoading, isViewingHistory]);

  // Switch round: load messages from API
  const handleSwitchRound = useCallback(async (index: number) => {
    const targetRound = rounds[index];
    if (!targetRound) return;

    setShowTransition(false);
    setCurrentRoundIndex(index);

    // Fetch messages for this round
    const fp = localStorage.getItem('jade_fingerprint');
    try {
      const res = await fetch(`/api/interview/${sessionId}`, {
        headers: fp ? { 'x-fingerprint': fp } : {},
      });
      const { rounds: roundsWithMessages } = await res.json();
      const roundData = roundsWithMessages.find((r: any) => r.id === targetRound.id);

      if (roundData?.messages?.length > 0) {
        setMessages(dbMessagesToUIMessages(roundData.messages));
        hydrateMessageFlags(flagsFromMessages(roundData.messages));
      } else {
        setMessages([]);
        hydrateMessageFlags({});
      }
    } catch (err) {
      console.error('Failed to load round messages:', err);
      setMessages([]);
    }

    const isDone = isRoundViewOnly(targetRound.status, sessionStatus);
    setIsViewingHistory(isDone);
    if (isDone) setShowTransition(false);

    // Reset init refs
    loadedRef.current = true;
    sentInitRef.current = targetRound.id;
  }, [rounds, sessionId, sessionStatus, setCurrentRoundIndex, setMessages, hydrateMessageFlags]);

  const handleNextRound = useCallback(() => {
    setShowTransition(false);
    setIsViewingHistory(false);
    advanceToNextRound();
    resetMessages();
    loadedRef.current = false;
    sentInitRef.current = null;
  }, [advanceToNextRound, resetMessages]);

  // 报告在「结束面试」时就生成，用户不用再经历一次「访问报告页才失败」。
  const handleGenerateReport = useCallback(async () => {
    setIsGeneratingReport(true);
    setIsGeneratingReportLocal(true);
    try {
      const fp = localStorage.getItem('jade_fingerprint');
      await fetch(`/api/interview/${sessionId}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(fp ? { 'x-fingerprint': fp } : {}),
          ...getAIHeaders(),
        },
        body: JSON.stringify({ locale, model: useSettingsStore.getState().aiModel }),
      });
    } catch {
      // 失败不拦人：报告页会显示可重试的分段进度
    }
    router.push(`/interview/${sessionId}/report`);
  }, [sessionId, router, setIsGeneratingReport, locale]);

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
  // 正在问的那道题：由面试官消息的 metadata 带出，用来重启倒计时。
  const currentQuestionId = (lastAssistantMsg?.metadata as { questionId?: string | null } | undefined)?.questionId ?? null;

  // 到点就把已写内容交上去并推进下一题；没写内容也照样推进，绝不丢答案也不卡住。
  const handleTimeout = useCallback(() => {
    if (isLoading || isViewingHistory) return;
    sendTimeout(input.trim() || TIMEOUT_MESSAGE);
    setInput('');
  }, [input, isLoading, isViewingHistory, sendTimeout, setInput]);

  const handleTriggerAI = useCallback((text: string) => {
    sendMessage({ text });
  }, [sendMessage]);

  const handleEndRound = useCallback(() => {
    setShowTransition(true);
  }, []);

  const controls = useInterviewControls({
    sessionId,
    roundId: currentRound?.id ?? '',
    lastAssistantMessageId: lastAssistantMsg?.id,
    isLoading,
    onTriggerAI: handleTriggerAI,
    onEndRound: handleEndRound,
  });

  if (!currentRound) return null;

  const isLastRound = currentRoundIndex >= rounds.length - 1;

  if (showTransition && !isViewingHistory) {
    const nextRound = rounds[currentRoundIndex + 1];
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <ProgressBar onSwitchRound={handleSwitchRound} />
        <RoundTransition
          nextInterviewer={(nextRound?.interviewerConfig as InterviewerConfig) || interviewerConfig}
          onContinue={isLastRound ? handleGenerateReport : handleNextRound}
          isLastRound={isLastRound}
          busy={isGeneratingReport}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 h-[calc(100dvh-120px)] md:h-[calc(100vh-180px)]">
      <ProgressBar onSwitchRound={handleSwitchRound} />
      <InterviewerBanner
        config={interviewerConfig}
        questionCount={(currentRound?.questions ?? []).filter((question) => (question.status ?? 'pending') !== 'pending').length}
      />
      <MessageList messages={messages} interviewerConfig={interviewerConfig} />
      {isLoading && (
        <div className="px-4">
          <ThinkingIndicator config={interviewerConfig} />
        </div>
      )}
      {isViewingHistory ? (
        <div className="border-t border-zinc-100 px-4 py-3 text-center text-sm text-zinc-400 dark:border-zinc-800">
          {t('roundComplete')}
        </div>
      ) : (
        <div className="space-y-2 border-t border-zinc-100 pt-2 pb-2 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            {controls}
            <QuestionTimer questionId={currentQuestionId} onExpire={handleTimeout} />
          </div>
          <MessageInput
            input={input}
            isLoading={isLoading}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
          />
        </div>
      )}
    </div>
  );
}
