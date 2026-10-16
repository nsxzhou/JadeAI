'use client';

import { useTranslations, useLocale } from 'next-intl';
import { SkipForward, Lightbulb, Bookmark, BookmarkCheck, StopCircle, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInterviewStore } from '@/stores/interview-store';
import { getAIHeaders } from '@/stores/settings-store';
import { HINT_MESSAGE, SKIP_MESSAGE } from '@/lib/interview/constants';

interface ControlBarProps {
  sessionId: string;
  roundId: string;
  lastAssistantMessageId?: string;
  isLoading: boolean;
  onTriggerAI: (text: string) => void;
  onEndRound: () => void;
}

export function useInterviewControls({ sessionId, roundId, lastAssistantMessageId, isLoading, onTriggerAI, onEndRound }: ControlBarProps) {
  const t = useTranslations('interview.room');
  const locale = useLocale();
  const { messageFlags, setMessageFlags } = useInterviewStore();
  const isMarked = lastAssistantMessageId ? Boolean(messageFlags[lastAssistantMessageId]?.marked) : false;

  /** 控制指令的落库结果以服务端返回的 metadata 为准。 */
  const sendControl = async (action: string, extra: Record<string, unknown> = {}) => {
    const fp = localStorage.getItem('jade_fingerprint');
    const res = await fetch(`/api/interview/${sessionId}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(fp ? { 'x-fingerprint': fp } : {}),
        ...getAIHeaders(),
      },
      body: JSON.stringify({ action, roundId, locale, ...extra }),
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  };

  const handleSkip = async () => {
    if (lastAssistantMessageId) {
      setMessageFlags(lastAssistantMessageId, { skipped: true });
      await sendControl('skip', { messageId: lastAssistantMessageId });
    } else {
      await sendControl('skip');
    }
    onTriggerAI(SKIP_MESSAGE);
  };

  const handleHint = async () => {
    if (lastAssistantMessageId) {
      setMessageFlags(lastAssistantMessageId, { hinted: true });
      await sendControl('hint', { messageId: lastAssistantMessageId });
    } else {
      await sendControl('hint');
    }
    onTriggerAI(HINT_MESSAGE);
  };

  const handleEndRound = async () => {
    await sendControl('end_round');
    onEndRound();
  };

  const handlePause = async () => {
    await sendControl('pause');
  };

  const handleMark = async () => {
    if (!lastAssistantMessageId) return;
    const next = !isMarked;
    setMessageFlags(lastAssistantMessageId, { marked: next });
    const result = await sendControl('mark', { messageId: lastAssistantMessageId, marked: next });
    if (result?.metadata) {
      setMessageFlags(lastAssistantMessageId, result.metadata);
    }
  };

  const controls = (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={handleSkip} disabled={isLoading}>
        <SkipForward className="h-3 w-3" />
        <span className="hidden sm:inline">{t('skip')}</span>
      </Button>
      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={handleHint} disabled={isLoading}>
        <Lightbulb className="h-3 w-3" />
        <span className="hidden sm:inline">{t('hint')}</span>
      </Button>
      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={handleMark} disabled={!lastAssistantMessageId}>
        {isMarked ? <BookmarkCheck className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
        <span className="hidden sm:inline">{isMarked ? t('unmark') : t('mark')}</span>
      </Button>
      <div className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-lg px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950" onClick={handleEndRound} disabled={isLoading}>
        <StopCircle className="h-3 w-3" />
        <span className="hidden sm:inline">{t('endRound')}</span>
      </Button>
      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={handlePause}>
        <Pause className="h-3 w-3" />
        <span className="hidden sm:inline">{t('pause')}</span>
      </Button>
    </div>
  );

  return controls;
}
