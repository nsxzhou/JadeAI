'use client';

import { use, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { InterviewRoom } from '@/components/interview/interview-room';
import { useInterviewStore } from '@/stores/interview-store';
import { getAIHeaders, useSettingsStore } from '@/stores/settings-store';
import { Skeleton } from '@/components/ui/skeleton';
import type { UIMessage } from 'ai';

/** Convert DB interview messages to UIMessage format for useChat */
function dbMessagesToUIMessages(dbMessages: any[]): UIMessage[] {
  return dbMessages
    .filter((m: any) => m.role !== 'system') // system messages are for AI context only
    .map((m: any) => ({
      id: m.id,
      role: m.role === 'interviewer' ? 'assistant' as const : 'user' as const,
      parts: [{ type: 'text' as const, text: m.content }],
      metadata: (m.metadata ?? {}) as Record<string, unknown>,
    }));
}

export default function InterviewRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const locale = useLocale();
  const t = useTranslations('interview.room');
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const { setSession } = useInterviewStore();

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      const fp = localStorage.getItem('jade_fingerprint');
      const res = await fetch(`/api/interview/${id}`, {
        headers: fp ? { 'x-fingerprint': fp } : {},
      });
      if (!res.ok) throw new Error('load failed');
      return res.json();
    };

    void (async () => {
      try {
        let { session, rounds } = await loadSession();

        // 题目先出好，对话才有依据。已经出过就跳过（接口幂等）。
        const hasQuestions = (rounds ?? []).some((round: any) => (round.questions?.length ?? 0) > 0);
        if (!hasQuestions) {
          if (!cancelled) setPreparing(true);
          const fp = localStorage.getItem('jade_fingerprint');
          const res = await fetch(`/api/interview/${id}/questions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(fp ? { 'x-fingerprint': fp } : {}),
              ...getAIHeaders(),
            },
            body: JSON.stringify({ locale, model: useSettingsStore.getState().aiModel }),
          });
          if (cancelled) return;
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data.error ?? 'Failed to prepare questions');
            setPreparing(false);
            setLoading(false);
            return;
          }
          ({ session, rounds } = await loadSession());
          if (cancelled) return;
          setPreparing(false);
        }

        // 暂停状态原样带进 store：页面重新打开时先显示暂停面板，
        // 由用户点「继续面试」再恢复，而不是偷偷把数据库里的 paused 当成进行中。
        setSession(session, rounds);

        const currentRound = rounds[session.currentRound];
        if (currentRound?.messages?.length > 0) {
          setInitialMessages(dbMessagesToUIMessages(currentRound.messages));
        }
        setLoading(false);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError('Failed to load interview');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, locale, setSession]);

  if (loading || preparing) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 py-8">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-[60vh] w-full" />
        <Skeleton className="h-20 w-full" />
        {preparing && (
          <p className="text-center text-sm text-zinc-500">{t('preparingQuestions')}</p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl py-16 text-center">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return <InterviewRoom sessionId={id} initialMessages={initialMessages} />;
}
