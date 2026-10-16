'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * 两个模式共用同一个入口：模拟面试（AI 扮演面试官，练手）与
 * 面试官视角（假设的真人扮演面试官，推演我会被怎么问、会被怎么判）。
 *
 * 产品立场：不再有「招聘」。这里只切换玩法，不切换模块。
 */
const MODES = [
  { href: '/interview', key: 'mock' },
  { href: '/interview/perspective', key: 'perspective' },
] as const;

export function InterviewModeSwitch() {
  const t = useTranslations('interview.modes');
  const pathname = usePathname();
  const activePerspective = pathname.startsWith('/interview/perspective');

  return (
    <div className="mb-6 inline-flex rounded-xl border border-zinc-200 bg-white p-1 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      {MODES.map((mode) => {
        const active = mode.key === 'perspective' ? activePerspective : !activePerspective;
        return (
          <Link
            key={mode.key}
            href={mode.href}
            className={cn(
              'cursor-pointer rounded-lg px-3 py-1.5 font-medium transition-colors',
              active
                ? 'bg-brand text-white'
                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
          >
            {t(mode.key)}
          </Link>
        );
      })}
    </div>
  );
}
