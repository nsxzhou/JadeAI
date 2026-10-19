'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { SkipForward, Lightbulb, Bookmark, BookmarkCheck, StopCircle, Pause, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useInterviewStore } from '@/stores/interview-store';
import { postInterviewControl, type InterviewControlAction } from '@/lib/interview/control-client';
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
  const { messageFlags, setMessageFlags, setStatus } = useInterviewStore();
  const [isPausing, setIsPausing] = useState(false);
  const isMarked = lastAssistantMessageId ? Boolean(messageFlags[lastAssistantMessageId]?.marked) : false;

  const sendControl = (action: InterviewControlAction, extra: Record<string, unknown> = {}) =>
    postInterviewControl(sessionId, action, { roundId, locale, ...extra });

  const handleSkip = async () => {
    if (lastAssistantMessageId) setMessageFlags(lastAssistantMessageId, { skipped: true });
    const result = await sendControl('skip', lastAssistantMessageId ? { messageId: lastAssistantMessageId } : {});
    if (!result.ok) {
      if (lastAssistantMessageId) setMessageFlags(lastAssistantMessageId, { skipped: false });
      toast.error(t('controlFailed'));
      return;
    }
    onTriggerAI(SKIP_MESSAGE);
  };

  const handleHint = async () => {
    if (lastAssistantMessageId) setMessageFlags(lastAssistantMessageId, { hinted: true });
    const result = await sendControl('hint', lastAssistantMessageId ? { messageId: lastAssistantMessageId } : {});
    if (!result.ok) {
      if (lastAssistantMessageId) setMessageFlags(lastAssistantMessageId, { hinted: false });
      toast.error(t('controlFailed'));
      return;
    }
    onTriggerAI(HINT_MESSAGE);
  };

  const handleEndRound = async () => {
    const result = await sendControl('end_round');
    if (!result.ok) {
      toast.error(t('controlFailed'));
      return;
    }
    onEndRound();
  };

  /** 暂停必须等服务端落库后再切界面：切早了刷新回来还是「面试中」，就是用户看到的「没反应」。 */
  const handlePause = async () => {
    if (isPausing) return;
    setIsPausing(true);
    try {
      const result = await sendControl('pause');
      if (!result.ok) {
        toast.error(t('pauseFailed'));
        return;
      }
      setStatus(result.status ?? 'paused');
    } finally {
      setIsPausing(false);
    }
  };

  const handleMark = async () => {
    if (!lastAssistantMessageId) return;
    const next = !isMarked;
    setMessageFlags(lastAssistantMessageId, { marked: next });
    const result = await sendControl('mark', { messageId: lastAssistantMessageId, marked: next });
    if (!result.ok) {
      setMessageFlags(lastAssistantMessageId, { marked: isMarked });
      toast.error(t('controlFailed'));
      return;
    }
    if (result.metadata) {
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
      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={handlePause} disabled={isPausing}>
        {isPausing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
        <span className="hidden sm:inline">{t('pause')}</span>
      </Button>
    </div>
  );

  return controls;
}
