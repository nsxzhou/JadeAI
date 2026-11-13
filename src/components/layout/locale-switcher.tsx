'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { locales, localeNames } from '@/i18n/config';
import { Globe } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Radix derives `aria-controls` from React's `useId()`, whose value depends on the
 * fiber path. If the SSR tree and the hydrating tree differ in shape (any extra
 * Suspense/Offscreen fiber is enough — the DOM stays identical), the ids disagree
 * and React logs a hydration mismatch and keeps the stale server value, leaving
 * the trigger pointing at a non-existent id. Pinning the id ourselves makes both
 * sides agree and keeps the ARIA reference correct.
 */
const MENU_ID = 'jade-locale-menu';

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function onValueChange(newLocale: string) {
    router.replace(pathname, { locale: newLocale });
  }

  return (
    <Select value={locale} onValueChange={onValueChange}>
      <SelectTrigger
        aria-controls={MENU_ID}
        className="w-auto gap-1.5 border-none bg-transparent px-2 text-sm shadow-none"
      >
        <Globe className="h-4 w-4 text-zinc-500" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent id={MENU_ID}>
        {locales.map((loc) => (
          <SelectItem key={loc} value={loc}>
            {localeNames[loc]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
