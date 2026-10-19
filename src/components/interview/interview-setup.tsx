'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JDInput } from './jd-input';
import { ResumeSelector } from './resume-selector';
import { InterviewerPicker } from './interviewer-picker';
import { useRouter } from '@/i18n/routing';
import { getAIHeaders } from '@/stores/settings-store';
import { cn } from '@/lib/utils';
import type { InterviewerConfig } from '@/types/interview';
import type { QuestionCountPreset, StressLevel } from '@/lib/interview-core/types';

const PRESETS: QuestionCountPreset[] = ['short', 'standard', 'long'];
const STRESS_LEVELS: StressLevel[] = ['gentle', 'standard', 'sharp'];
const ROLE_FAMILIES = ['auto', 'backend', 'frontend', 'data_algo', 'qa_infra', 'other'] as const;

type TimeChoice = 'unlimited' | 'one' | 'two' | 'three' | 'five' | 'custom';
const TIME_CHOICES: TimeChoice[] = ['unlimited', 'one', 'two', 'three', 'five', 'custom'];
const TIME_CHOICE_SEC: Record<Exclude<TimeChoice, 'unlimited' | 'custom'>, number> = {
  one: 60,
  two: 120,
  three: 180,
  five: 300,
};

/** 三个选项以内用分段按钮，比下拉少一次点击，也能一眼看到全部选项。 */
function ChoiceRow<T extends string>({ options, value, onChange, labelOf }: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labelOf: (option: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition-colors',
            value === option
              ? 'border-brand bg-brand/10 font-medium text-brand'
              : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300',
          )}
        >
          {labelOf(option)}
        </button>
      ))}
    </div>
  );
}

export function InterviewSetup() {
  const t = useTranslations('interview.setup');
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [jd, setJd] = useState('');
  const [resumeId, setResumeId] = useState<string | undefined>();
  const [selectedInterviewers, setSelectedInterviewers] = useState<InterviewerConfig[]>([]);
  // 题数预设与压力面强度是每场策略；岗位族默认交给服务端从静态清单里选。
  const [preset, setPreset] = useState<QuestionCountPreset>('standard');
  const [stress, setStress] = useState<StressLevel>('gentle');
  const [roleFamily, setRoleFamily] = useState<(typeof ROLE_FAMILIES)[number]>('auto');
  // 每题限时：默认 3 分钟；可以显式选择「不限时」或自定义分钟数。
  const [timeChoice, setTimeChoice] = useState<TimeChoice>('three');
  const [customMinutes, setCustomMinutes] = useState('3');
  const [isCreating, setIsCreating] = useState(false);

  const customMinutesValue = Number(customMinutes);
  const customMinutesValid =
    Number.isFinite(customMinutesValue)
    && customMinutesValue >= 1
    && customMinutesValue <= 60;
  const questionTimeLimitSec =
    timeChoice === 'unlimited'
      ? null
      : timeChoice === 'custom'
        ? customMinutesValid
          ? Math.round(customMinutesValue * 60)
          : null
        : TIME_CHOICE_SEC[timeChoice];
  const timeChoiceValid = timeChoice !== 'custom' || customMinutesValid;

  const canStart = jd.trim().length > 0 && selectedInterviewers.length > 0 && timeChoiceValid;

  const handleStart = async () => {
    if (!canStart) return;
    setIsCreating(true);

    try {
      const fp = localStorage.getItem('jade_fingerprint');
      const res = await fetch('/api/interview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(fp ? { 'x-fingerprint': fp } : {}),
          ...getAIHeaders(),
        },
        body: JSON.stringify({
          jobDescription: jd,
          jobTitle: title.trim() || jd.split('\n')[0].slice(0, 100) || 'Interview',
          resumeId,
          interviewers: selectedInterviewers,
          questionCountPreset: preset,
          stressLevel: stress,
          questionTimeLimitSec,
          ...(roleFamily === 'auto' ? {} : { roleFamilyKey: roleFamily }),
        }),
      });

      if (!res.ok) throw new Error('Failed to create interview');
      const { session } = await res.json();
      router.push(`/interview/${session.id}`);
    } catch (err) {
      console.error('Failed to create interview:', err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 rounded-xl bg-gradient-to-r from-brand-muted to-white px-6 py-5 dark:from-brand-muted/30 dark:to-zinc-900">
        <h1 className="text-xl font-bold">🎙️ {t('title')}</h1>
      </div>
      <div className="space-y-6 px-1">
        {/* Title input */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand text-[10px] font-bold text-white">0</span>
            {t('titleLabel')}
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('titlePlaceholder')}
            className="rounded-xl"
          />
        </div>
        <JDInput value={jd} onChange={setJd} />
        <ResumeSelector value={resumeId} onChange={setResumeId} />

        <div className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <div className="mb-2 text-sm font-semibold">{t('questionCountLabel')}</div>
            <ChoiceRow options={PRESETS} value={preset} onChange={setPreset} labelOf={(p) => t(`presets.${p}`)} />
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold">{t('questionTimeLabel')}</div>
            <ChoiceRow
              options={TIME_CHOICES}
              value={timeChoice}
              onChange={setTimeChoice}
              labelOf={(choice) => t(`questionTime.${choice}`)}
            />
            {timeChoice === 'custom' && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  placeholder={t('questionTime.customPlaceholder')}
                  className="h-8 w-24 rounded-lg text-xs"
                />
                <span className="text-xs text-zinc-500">{t('questionTime.minutesSuffix')}</span>
                {!customMinutesValid && (
                  <span className="text-xs text-red-500">{t('questionTime.customRange')}</span>
                )}
              </div>
            )}
            <p className="mt-2 text-xs text-zinc-500">{t('questionTime.hint')}</p>
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold">{t('stressLabel')}</div>
            <ChoiceRow options={STRESS_LEVELS} value={stress} onChange={setStress} labelOf={(s) => t(`stressLevels.${s}`)} />
            <p className="mt-2 text-xs text-zinc-500">{t('stressHint')}</p>
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold">{t('roleFamilyLabel')}</div>
            <ChoiceRow
              options={ROLE_FAMILIES}
              value={roleFamily}
              onChange={setRoleFamily}
              labelOf={(key) => t(`roleFamilies.${key}`)}
            />
            <p className="mt-2 text-xs text-zinc-500">{t('roleFamilyHint')}</p>
          </div>
        </div>

        <InterviewerPicker selected={selectedInterviewers} onChange={setSelectedInterviewers} />
      </div>
      <div className="mt-8 px-1">
        <Button
          onClick={handleStart}
          disabled={!canStart || isCreating}
          className="w-full rounded-xl bg-gradient-to-r from-brand to-brand-hover py-6 text-base font-semibold hover:from-brand-hover hover:to-brand-hover"
          size="lg"
        >
          {isCreating ? '...' : t('startInterview')}
        </Button>
      </div>
    </div>
  );
}
