'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { InterviewReportView } from '@/components/interview/interview-report';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useSettingsStore, getAIHeaders } from '@/stores/settings-store';
import type { InterviewReport, InterviewSession } from '@/types/interview';

interface PartialState {
  failingRoundId: string | null;
  pendingRoundIds: string[];
}

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('interview.report');
  const locale = useLocale();
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [partial, setPartial] = useState<PartialState | null>(null);
  const [failed, setFailed] = useState(false);
  const hydrated = useSettingsStore((s) => s._hydrated);

  const headers = useCallback((): Record<string, string> => {
    const fp = localStorage.getItem('jade_fingerprint');
    return {
      'Content-Type': 'application/json',
      ...(fp ? { 'x-fingerprint': fp } : {}),
      ...getAIHeaders(),
    };
  }, []);

  /** 逐轮补 / 汇总：单轮失败时后端返回 failingRoundId，可只重跑那一轮。 */
  const generate = useCallback(async (roundId?: string) => {
    const res = await fetch(`/api/interview/${id}/report`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ locale, roundId, model: useSettingsStore.getState().aiModel }),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.status === 'complete' && data.report) {
      setReport(data.report);
      setPartial(null);
      setFailed(false);
      return true;
    }
    if (data?.status === 'partial') {
      setPartial({
        failingRoundId: data.failingRoundId ?? null,
        pendingRoundIds: data.pendingRoundIds ?? (data.failingRoundId ? [data.failingRoundId] : []),
      });
      setFailed(false);
      return false;
    }
    setFailed(true);
    return false;
  }, [id, locale, headers]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    void (async () => {
      try {
        const sessionRes = await fetch(`/api/interview/${id}`, { headers: headers() });
        const { session: loadedSession, report: embeddedReport } = await sessionRes.json();
        if (cancelled) return;
        setSession(loadedSession);

        if (embeddedReport) {
          setReport(embeddedReport);
          setLoading(false);
          return;
        }

        const statusRes = await fetch(`/api/interview/${id}/report`, { headers: headers() });
        const status = await statusRes.json();
        if (cancelled) return;
        if (status?.status === 'complete' && status.report) {
          setReport(status.report);
          setLoading(false);
          return;
        }

        // 报告在「结束面试」时已经尝试生成过；这里只是补生成/重试。
        await generate();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, hydrated, headers, generate]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 py-8">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
        <p className="text-center text-sm text-zinc-500">{t('generating')}</p>
      </div>
    );
  }

  if (report && session) {
    return <InterviewReportView report={report} session={session} />;
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 py-20 text-center">
      <p className="text-sm text-zinc-500">
        {failed
          ? t('generationFailed')
          : t('partialError', { count: partial?.pendingRoundIds.length ?? 0 })}
      </p>
      <div className="flex justify-center gap-2">
        {partial?.failingRoundId && (
          <Button onClick={() => void generate(partial.failingRoundId ?? undefined)}>
            {t('retryRound')}
          </Button>
        )}
        <Button variant="outline" onClick={() => void generate()}>
          {t('retryAll')}
        </Button>
      </div>
    </div>
  );
}
