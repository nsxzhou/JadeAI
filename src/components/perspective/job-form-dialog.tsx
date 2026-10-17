'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DimensionChips } from './dimension-chips';
import {
  jobDimensions,
  normalizeJobCoordinates,
  presetDimensionKeys,
} from '@/lib/perspective/job-coordinates';
import { normalizePrimaryStack, normalizeRoleFamily } from '@/lib/interview-core/role-family';
import { normalizeQuestionCounts } from '@/lib/interview-core/dimension';
import { useFingerprint } from '@/hooks/use-fingerprint';
import { getAIHeaders } from '@/stores/settings-store';
import { cn } from '@/lib/utils';
import {
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_MIN,
  type DimensionConfig,
  type RecruitJob,
} from '@/types/perspective';
import type { PrimaryStack, RoleFamilyKey } from '@/lib/interview-core/types';

const ROLE_FAMILIES: RoleFamilyKey[] = ['backend', 'frontend', 'data_algo', 'qa_infra', 'other'];
const PRIMARY_STACKS: PrimaryStack[] = ['go', 'java', 'python', 'node', 'none'];

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

interface JobFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入表示编辑，不传表示新建 */
  job?: RecruitJob | null;
  onSaved: (job: RecruitJob) => void;
}

export function JobFormDialog({ open, onOpenChange, job, onSaved }: JobFormDialogProps) {
  const t = useTranslations('perspective');
  const tDim = useTranslations('perspective.dimensions');
  const { fingerprint } = useFingerprint();

  const [title, setTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [roleFamilyKey, setRoleFamilyKey] = useState<RoleFamilyKey>('other');
  const [primaryStack, setPrimaryStack] = useState<PrimaryStack>('none');
  const [dimensions, setDimensions] = useState<DimensionConfig[]>([]);
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [recognizing, setRecognizing] = useState(false);

  const labelOf = useCallback((key: string) => tDim(key), [tDim]);
  const describeOf = useCallback((key: string) => tDim(`descriptions.${key}`), [tDim]);

  // 每次打开都重置成当前岗位的值——不这么做的话，编辑完 A 再打开 B 会看到 A 的内容。
  useEffect(() => {
    if (!open) return;
    setTitle(job?.title ?? '');
    setJobDescription(job?.jobDescription ?? '');

    // 老岗位没有显式坐标，`normalizeJobCoordinates` 会按旧目录推导（岗位族、题数都在里面）。
    const coordinates = job
      ? normalizeJobCoordinates(job)
      : { roleFamilyKey: 'other' as RoleFamilyKey, primaryStack: 'none' as PrimaryStack, dimensions: [], questionCounts: {} };

    setRoleFamilyKey(coordinates.roleFamilyKey);
    setPrimaryStack(coordinates.primaryStack);

    const nextDimensions = jobDimensions({
      roleFamilyKey: coordinates.roleFamilyKey,
      primaryStack: coordinates.primaryStack,
      previous: coordinates.dimensions,
      labelOf,
      describeOf,
    });
    setDimensions(nextDimensions);
    setQuestionCounts(normalizeQuestionCounts(nextDimensions, coordinates.questionCounts));
  }, [open, job, labelOf, describeOf]);

  const total = useMemo(
    () => dimensions.reduce((sum, dimension) => sum + (questionCounts[dimension.key] ?? 0), 0),
    [dimensions, questionCounts],
  );
  const presetKeys = presetDimensionKeys(roleFamilyKey, primaryStack);
  const totalValid = total >= QUESTION_COUNT_MIN && total <= QUESTION_COUNT_MAX;
  const canSave = Boolean(title.trim() && jobDescription.trim() && dimensions.length > 0 && totalValid && !saving);

  /** 换岗位族：族层维度换一批，通用层与自定义维度、用户改过的文案都保留。 */
  function changeCoordinates(next: { roleFamilyKey?: RoleFamilyKey; primaryStack?: PrimaryStack }) {
    const nextFamily = next.roleFamilyKey ?? roleFamilyKey;
    const nextStack = next.primaryStack ?? primaryStack;
    setRoleFamilyKey(nextFamily);
    setPrimaryStack(nextStack);

    const nextDimensions = jobDimensions({
      roleFamilyKey: nextFamily,
      primaryStack: nextStack,
      previous: dimensions,
      custom: dimensions.filter((dimension) => dimension.custom),
      labelOf,
      describeOf,
    });
    setDimensions(nextDimensions);
    setQuestionCounts(normalizeQuestionCounts(nextDimensions, questionCounts));
  }

  async function recognizeDimensions() {
    if (!title.trim() || !jobDescription.trim()) {
      toast.error(t('dimensions.needJobInfo'));
      return;
    }
    setRecognizing(true);
    try {
      const response = await fetch('/api/perspective/dimensions/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getAIHeaders() },
        body: JSON.stringify({ title, jobDescription }),
      });
      if (!response.ok) throw new Error('suggest failed');
      const data = await response.json();
      const nextFamily = normalizeRoleFamily(data.roleFamilyKey);
      const nextStack = normalizePrimaryStack(data.primaryStack);
      setRoleFamilyKey(nextFamily);
      setPrimaryStack(nextStack);
      setDimensions(data.dimensions);
      setQuestionCounts(normalizeQuestionCounts(data.dimensions, data.questionCounts));
      toast.success(t('dimensions.recognizeSuccess'));
    } catch {
      toast.error(t('dimensions.recognizeFailed'));
    } finally {
      setRecognizing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = job ? `/api/perspective/jobs/${job.id}` : '/api/perspective/jobs';
      const res = await fetch(url, {
        method: job ? 'PATCH' : 'POST',
        headers: {
          'content-type': 'application/json',
          ...(fingerprint ? { 'x-fingerprint': fingerprint } : {}),
        },
        body: JSON.stringify({
          title,
          jobDescription,
          roleFamilyKey,
          primaryStack,
          dimensions,
          questionCounts,
        }),
      });
      if (!res.ok) throw new Error('save failed');
      const data = await res.json();
      onSaved(data.job);
      onOpenChange(false);
    } catch {
      toast.error(t('errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 必须带 sm: 前缀：DialogContent 基类里的 sm:max-w-lg 是个 variant，
          tailwind-merge 不会拿无前缀的 max-w-* 去覆盖它，写 max-w-2xl 是无效的 */}
      <DialogContent
        className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-4xl"
        // Radix 打开时会聚焦第一个可聚焦元素，且对 input 会连带 select() 全选。
        // 编辑岗位时那就是「岗位名称」，一进来整个标题反白，手一抖就没了。
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{job ? t('editJob') : t('createJob')}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="job-title">{t('jobTitle')}</Label>
            <Input
              id="job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('jobTitlePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="job-jd">{t('jobDescription')}</Label>
            <Textarea
              id="job-jd"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder={t('jobDescriptionPlaceholder')}
              // Textarea 是 field-sizing-content，rows 不起作用，只能用 min/max-h：
              // 不封顶的话一份长 JD 会把整个弹窗撑到几千像素
              className="max-h-[240px] min-h-[160px] overflow-y-auto"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium">{t('roleFamilyLabel')}</div>
              <ChoiceRow
                options={ROLE_FAMILIES}
                value={roleFamilyKey}
                onChange={(next) => changeCoordinates({ roleFamilyKey: next })}
                labelOf={(key) => t(`roleFamilies.${key}`)}
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">{t('primaryStackLabel')}</div>
              <ChoiceRow
                options={PRIMARY_STACKS}
                value={primaryStack}
                onChange={(next) => changeCoordinates({ primaryStack: next })}
                labelOf={(key) => t(`primaryStacks.${key}`)}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-zinc-500">{t('roleFamilyHint')}</p>

          <DimensionChips
            value={dimensions}
            questionCounts={questionCounts}
            onChange={(nextDimensions, nextCounts) => {
              setDimensions(nextDimensions);
              setQuestionCounts(nextCounts);
            }}
            presetKeys={presetKeys}
            onAIRecognize={() => void recognizeDimensions()}
            aiRecognizing={recognizing}
          />

          {!totalValid && dimensions.length > 0 && (
            <p className="text-xs text-red-500">
              {t('questionCountRange', { min: QUESTION_COUNT_MIN, max: QUESTION_COUNT_MAX })}
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="cursor-pointer bg-brand hover:bg-brand-hover"
          >
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
