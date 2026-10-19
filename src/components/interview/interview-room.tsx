'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { UIMessage } from 'ai';
import { Loader2, PauseCircle, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { useInterviewStore } from '@/stores/interview-store';
import type { InterviewMessageMetadata } from '@/types/interview';
import { useInterviewChat } from '@/hooks/use-interview-chat';
import { getAIHeaders, useSettingsStore } from '@/stores/settings-store';
import { INIT_TRIGGER, TIMEOUT_MESSAGE } from '@/lib/interview/constants';
import { postInterviewControl } from '@/lib/interview/control-client';
import { isRoundViewOnly } from '@/lib/interview/round-status';
import { QUESTION_TIME_LIMIT_SEC } from '@/lib/interview-core/types';
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
  const { rounds, currentRoundIndex, setCurrentRoundIndex, advanceToNextRound, setIsGeneratingReport, status: sessionStatus, setStatus, hydrateMessageFlags, currentSession } =
    useInterviewStore();
  const [showTransition, setShowTransition] = useState(false);
  const [isViewingHistory, setIsViewingHistory] = useState(false);
  const [isGeneratingReport, setIsGeneratingReportLocal] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const isPaused = sessionStatus === 'paused';

  const currentRound = rounds[currentRoundIndex];
  const interviewerConfig = currentRound?.interviewerConfig as InterviewerConfig;
  const isRoundDone = isRoundViewOnly(currentRound?.status, sessionStatus);
  // 老会话没有这一列时按默认 180 秒处理；null 才是用户显式选择的「不限时」。
  const questionTimeLimitSec =
    currentSession?.questionTimeLimitSec === undefined
      ? QUESTION_TIME_LIMIT_SEC
      : currentSession.questionTimeLimitSec;

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

  // Auto-send trigger to start interview (only if no history and round is active).
  // 暂停时不发：恢复后由 isPaused 变化重新触发，补上应有的开场。
  const sentInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (isPaused) return;
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
  }, [currentRound?.id, isPaused]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!messages.length || isLoading || isViewingHistory || isPaused) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'assistant') return;
    const meta = lastMsg.metadata as InterviewMessageMetadata | undefined;
    const text = lastMsg.parts?.find((p: any) => p.type === 'text');
    if (meta?.roundComplete || (text as any)?.text?.includes('[ROUND_COMPLETE]')) {
      setShowTransition(true);
    }
  }, [messages, isLoading, isViewingHistory, isPaused]);

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

  /** 恢复面试：先让服务端落库，成功后再把界面切回对话，避免「点了继续却还停在暂停面板」。 */
  const handleResume = useCallback(async () => {
    if (isResuming) return;
    setIsResuming(true);
    try {
      const result = await postInterviewControl(sessionId, 'resume');
      if (!result.ok) {
        if (result.status === 'completed') {
          setStatus('completed');
          toast.error(t('sessionCompleted'));
          router.push(`/interview/${sessionId}/report`);
          return;
        }
        toast.error(t('resumeFailed'));
        return;
      }
      const nextStatus = result.status ?? 'in_progress';
      setStatus(nextStatus);
      // 暂停期间本轮可能已经收尾（流式回答在后台完成）。恢复后直接进转场，
      // 否则界面会停在「本轮面试结束」而没有任何继续/出报告的入口。
      if (nextStatus !== 'completed' && isRoundDone) {
        setIsViewingHistory(false);
        setShowTransition(true);
      }
    } finally {
      setIsResuming(false);
    }
  }, [isResuming, sessionId, setStatus, router, t, isRoundDone]);

  // 到点就把已写内容交上去并推进下一题；没写内容也照样推进，绝不丢答案也不卡住。
  // 暂停时绝不交卷：计时在走，但发送权留给回来的人。
  const handleTimeout = useCallback(() => {
    if (isPaused || isLoading || isViewingHistory) return;
    sendTimeout(input.trim() || TIMEOUT_MESSAGE);
    setInput('');
  }, [input, isPaused, isLoading, isViewingHistory, sendTimeout, setInput]);

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

  if (showTransition && !isViewingHistory && !isPaused) {
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
      <div className="space-y-2 border-t border-zinc-100 pt-2 pb-2 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          {isPaused ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <PauseCircle className="h-3.5 w-3.5" />
              {t('pausedBadge')}
            </span>
          ) : isViewingHistory ? null : (
            controls
          )}
          {/* 计时器始终挂载：暂停时继续走表，但不自动交卷，恢复后剩余时间不会重置。 */}
          {!isViewingHistory && (
            <QuestionTimer
              key={currentQuestionId ?? 'none'}
              questionId={currentQuestionId}
              limitSec={questionTimeLimitSec}
              paused={isPaused}
              onExpire={handleTimeout}
            />
          )}
        </div>

        {isPaused ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-5 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
            <PauseCircle className="h-6 w-6 text-zinc-400" />
            <div>
              <p className="text-sm font-semibold">{t('pausedTitle')}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{t('pausedHint')}</p>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void handleResume()}
                disabled={isResuming}
                className="h-8 cursor-pointer gap-1.5 rounded-lg bg-brand text-xs hover:bg-brand-hover"
              >
                {isResuming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {isResuming ? t('resuming') : t('resume')}
              </Button>
              <Link href="/interview">
                <Button variant="ghost" size="sm" className="h-8 cursor-pointer text-xs text-zinc-500">
                  {t('backToLobby')}
                </Button>
              </Link>
            </div>
          </div>
        ) : isViewingHistory ? (
          <div className="py-2 text-center text-sm text-zinc-400">{t('roundComplete')}</div>
        ) : (
          <MessageInput
            input={input}
            isLoading={isLoading}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}
