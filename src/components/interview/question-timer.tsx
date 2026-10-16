'use client';

import { useEffect, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QUESTION_TIME_LIMIT_SEC } from '@/lib/interview-core/types';

interface QuestionTimerProps {
  /** 当前题标识：变化即重新开始计时；null 表示不计时 */
  questionId: string | null;
  /** 超时回调 */
  onExpire: () => void;
}

function format(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 每题倒计时（含该题追问）。
 *
 * 计时不停：没有暂停累计，走神就是走神——真实面试里不会因为你去接水就把钟停下。
 * 到点由调用方把已写内容交上去并推进下一题。
 */
export function QuestionTimer({ questionId, onExpire }: QuestionTimerProps) {
  const [remaining, setRemaining] = useState(QUESTION_TIME_LIMIT_SEC);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    if (!questionId) {
      setRemaining(QUESTION_TIME_LIMIT_SEC);
      return;
    }

    const startedAt = Date.now();
    setRemaining(QUESTION_TIME_LIMIT_SEC);
    let fired = false;

    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil(QUESTION_TIME_LIMIT_SEC - (Date.now() - startedAt) / 1000));
      setRemaining(left);
      if (left === 0 && !fired) {
        fired = true;
        window.clearInterval(timer);
        expireRef.current();
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [questionId]);

  if (!questionId) return null;

  const urgent = remaining <= 30;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs tabular-nums',
        urgent
          ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
          : 'border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400',
      )}
      title={format(remaining)}
    >
      <Timer className="h-3 w-3" />
      {format(remaining)}
      <span className="sr-only">{`/ ${format(QUESTION_TIME_LIMIT_SEC)}`}</span>
    </div>
  );
}
