'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ArrowLeft, TrendingUp } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ProfilePoint { sessionId: string; createdAt: string; score: number }
interface Series { key: string; label: string; points: ProfilePoint[]; latest: number | null; delta: number; roleFamilyKey?: string }
interface Profile { general: Series[]; family: Series[]; sessionCount: number }

const COLORS = ['#ec4899', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#14b8a6'];

/** 把各维度的点对齐到「第 N 场」的横轴上，recharts 需要统一的行数据。 */
function toChartData(series: Series[]) {
  const maxPoints = Math.max(0, ...series.map((s) => s.points.length));
  return Array.from({ length: maxPoints }, (_, index) => {
    const row: Record<string, string | number> = { session: `#${index + 1}` };
    for (const item of series) {
      const point = item.points[index];
      if (point) row[item.label] = point.score;
    }
    return row;
  });
}

export default function ProfilePage() {
  const t = useTranslations('interview.profile');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fp = localStorage.getItem('jade_fingerprint');
    fetch('/api/interview/profile', { headers: fp ? { 'x-fingerprint': fp } : {} })
      .then((res) => res.json())
      .then((data) => setProfile(data.profile ?? null))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const familyByRole = new Map<string, Series[]>();
  for (const series of profile?.family ?? []) {
    const list = familyByRole.get(series.roleFamilyKey ?? 'other') ?? [];
    list.push(series);
    familyByRole.set(series.roleFamilyKey ?? 'other', list);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link href="/interview">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('back')}
          </Button>
        </Link>
        <Link href="/interview/weak-questions">
          <Button variant="outline" size="sm">
            {t('weak')}
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t('subtitle')}</p>
      </div>

      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : !profile || profile.general.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500">{t('noData')}</p>
      ) : (
        <>
          <p className="text-xs text-zinc-400">{t('sessions', { count: profile.sessionCount })}</p>

          <Card className="p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="h-4 w-4" />
              {t('general')}
            </h2>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={toChartData(profile.general)}>
                <XAxis dataKey="session" className="text-xs" />
                <YAxis domain={[0, 100]} className="text-xs" />
                <Tooltip />
                {profile.general.map((series, index) => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.label}
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {profile.general.map((series, index) => (
                <div key={series.key} className="rounded-lg border p-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
                    <span className="truncate text-xs text-zinc-500">{series.label}</span>
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums">{series.latest ?? '—'}</div>
                  <div className={cn('text-[11px] tabular-nums', series.delta >= 0 ? 'text-green-600' : 'text-red-500')}>
                    {t('delta', { delta: `${series.delta >= 0 ? '+' : ''}${series.delta}` })}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {familyByRole.size > 0 && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold">{t('family')}</h2>
              <div className="space-y-4">
                {[...familyByRole.entries()].map(([role, series]) => (
                  <div key={role}>
                    <div className="mb-2 text-xs font-medium text-zinc-500">{role}</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {series.map((item) => (
                        <div key={item.key} className="rounded-lg border p-2.5">
                          <div className="truncate text-xs text-zinc-500">{item.label}</div>
                          <div className="mt-1 text-base font-bold tabular-nums">{item.latest ?? '—'}</div>
                          <div className="text-[11px] text-zinc-400">
                            {t('latest', { score: item.points[item.points.length - 1]?.score ?? '—' })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
