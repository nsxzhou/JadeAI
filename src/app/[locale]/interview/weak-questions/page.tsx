'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { ArrowLeft, RotateCcw, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getAIHeaders } from '@/stores/settings-store';
import { cn } from '@/lib/utils';

type WeakSource = 'mock' | 'perspective';
interface Attempt { sessionId: string | null; answer: string; score: number | null; createdAt: string; source?: WeakSource }
interface Entry {
  rootId: string;
  question: {
    id?: string;
    question: string;
    intent: string;
    status?: string;
    timedOut?: boolean;
    markedWeak?: boolean;
  };
  sessionId: string | null;
  source?: WeakSource;
  jobTitle?: string;
  attempts: Attempt[];
}

export default function WeakQuestionsPage() {
  const t = useTranslations('interview.weak');
  const locale = useLocale();
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const fp = localStorage.getItem('jade_fingerprint');
    fetch('/api/interview/weak-questions', { headers: fp ? { 'x-fingerprint': fp } : {} })
      .then((res) => res.json())
      .then((data) => {
        setEntries(data.entries ?? []);
        setLimit(data.retryLimit ?? 10);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const toggle = (rootId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else if (next.size < limit) next.add(rootId);
      return next;
    });
  };

  const handleRetry = async () => {
    if (selected.size === 0) return;
    setRetrying(true);
    try {
      const fp = localStorage.getItem('jade_fingerprint');
      const res = await fetch('/api/interview/retry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(fp ? { 'x-fingerprint': fp } : {}),
          ...getAIHeaders(),
        },
        body: JSON.stringify({ questionIds: [...selected], locale }),
      });
      if (!res.ok) throw new Error('retry failed');
      const data = await res.json();
      router.push(`/interview/${data.sessionId}`);
    } catch (error) {
      console.error(error);
      setRetrying(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link href="/interview">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('back')}
          </Button>
        </Link>
        <Link href="/interview/profile">
          <Button variant="outline" size="sm">
            <TrendingUp className="mr-1 h-4 w-4" />
            {t('profile')}
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t('subtitle')}</p>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : entries.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500">{t('noData')}</p>
      ) : (
        <>
          <div className="flex justify-end">
            <Button disabled={selected.size === 0 || retrying} onClick={() => void handleRetry()}>
              <RotateCcw className="mr-1 h-4 w-4" />
              {retrying ? t('retrying') : t('retry', { count: selected.size })}
            </Button>
          </div>

          <div className="space-y-3">
            {entries.map((entry) => (
              <Card key={entry.rootId} className="p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 cursor-pointer"
                    checked={selected.has(entry.rootId)}
                    onChange={() => toggle(entry.rootId)}
                    aria-label={t('select')}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{entry.question.question}</p>
                      {entry.question.timedOut && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-500 dark:bg-red-950/40">{t('timedOut')}</span>
                      )}
                      {entry.question.status === 'skipped' && (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">{t('skipped')}</span>
                      )}
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] text-brand">
                        {t(`source.${entry.source ?? 'mock'}`)}
                      </span>
                      {entry.jobTitle && (
                        <span className="truncate text-[10px] text-zinc-400">{entry.jobTitle}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t('intent')}: {entry.question.intent}
                    </p>

                    <div className="mt-3 space-y-2">
                      <div className="text-xs font-medium text-zinc-500">{t('attempts')}</div>
                      {entry.attempts.map((attempt, index) => (
                        <div key={`${attempt.sessionId}-${index}`} className="rounded-lg border p-2.5">
                          <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
                            <span>
                              {new Date(attempt.createdAt).toLocaleDateString()}
                            </span>
                            <span className={cn('tabular-nums', attempt.score !== null && attempt.score < 60 ? 'text-red-500' : 'text-zinc-500')}>
                              {attempt.score !== null ? t('score', { score: attempt.score }) : t('unscored')}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-300">
                            {attempt.answer || '—'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
