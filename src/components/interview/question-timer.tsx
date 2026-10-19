'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QUESTION_TIME_LIMIT_SEC } from '@/lib/interview-core/types';

interface QuestionTimerProps {
  /** 当前题标识：变化即重新开始计时；null 表示不计时 */
  questionId: string | null;
  /** 本题限时（秒）；null = 不限时，只正计时、不自动交卷；缺省按默认 180 秒 */
  limitSec?: number | null;
  /** 超时回调 */
  onExpire: () => void;
  /** 暂停面试：计时不停（与真实面试一致），但到点不自动交卷 */
  paused?: boolean;
}

function format(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 每题倒计时（含该题追问）。
 *
 * 限时可设为「不限时」：此时只显示正计时，永远不自动交卷。
 * 有倒计时时依然「计时不停」：没有暂停累计，走神就是走神——真实面试里不会因为
 * 你去接水就把钟停下。但暂停面试时到点不自动交卷，否则用户回来会发现题已经被
 * 悄悄跳过了；恢复后如果这一题已经超时，仍由候选人自己点发送，用时服务端照实记账。
 */
export function QuestionTimer({ questionId, limitSec, onExpire, paused = false }: QuestionTimerProps) {
  const t = useTranslations('interview.room');
  const limit = limitSec === undefined ? QUESTION_TIME_LIMIT_SEC : limitSec;
  const unlimited = limit === null || limit <= 0;
  const [remaining, setRemaining] = useState(unlimited ? 0 : limit);
  const [elapsed, setElapsed] = useState(0);
  const expireRef = useRef(onExpire);
  const pausedRef = useRef(paused);

  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    // questionId 变化时由父组件用 key 重新挂载，初始 state 就是完整时限；
    // 这里不再同步 setState，避免 effect 内的级联渲染。
    if (!questionId) return;

    const startedAt = Date.now();
    let finished = false;

    const timer = window.setInterval(() => {
      if (unlimited) {
        setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        return;
      }

      const left = Math.max(0, Math.ceil(limit - (Date.now() - startedAt) / 1000));
      setRemaining(left);
      if (left > 0 || finished) return;

      finished = true;
      window.clearInterval(timer);

      // 暂停期间到点：不自动提交，也不再补一次自动交卷。
      // 恢复后由候选人自己决定何时发送，避免回来时题目已经被系统替他跳过。
      if (pausedRef.current) return;
      expireRef.current();
    }, 500);

    return () => window.clearInterval(timer);
  }, [questionId, limit, unlimited]);

  if (!questionId) return null;

  const urgent = !unlimited && remaining <= 30;
  const shown = unlimited ? elapsed : remaining;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs tabular-nums',
        urgent
          ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
          : 'border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400',
      )}
      title={unlimited ? t('unlimited') : format(limit)}
    >
      <Timer className="h-3 w-3" />
      {format(shown)}
      {unlimited ? (
        <span className="text-[10px] text-zinc-400">{t('unlimited')}</span>
      ) : (
        <span className="sr-only">{`/ ${format(limit)}`}</span>
      )}
    </div>
  );
}
