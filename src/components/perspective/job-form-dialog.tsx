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
import {
  normalizePrimaryStack,
  normalizeRoleFamily,
  resolveRoleFamily,
} from '@/lib/interview-core/role-family';
import {
  normalizeQuestionCounts,
  planQuestionCounts,
  totalQuestions,
} from '@/lib/interview-core/dimension';
import { useFingerprint } from '@/hooks/use-fingerprint';
import { getAIHeaders } from '@/stores/settings-store';
import { cn } from '@/lib/utils';
import {
  QUESTION_COUNT_DEFAULT,
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
  // 新建岗位默认自动识别坐标；用户手动点过对应选择后就不再覆盖。
  const [roleTouched, setRoleTouched] = useState(false);
  const [stackTouched, setStackTouched] = useState(false);
  const [countsTouched, setCountsTouched] = useState(false);

  const labelOf = useCallback((key: string) => tDim(key), [tDim]);
  const describeOf = useCallback((key: string) => tDim(`descriptions.${key}`), [tDim]);

  /** 按坐标重建维度，保留通用层文案、自定义维度与用户改过的描述。 */
  const dimensionsFor = useCallback(
    (nextRole: RoleFamilyKey, nextStack: PrimaryStack, previous: DimensionConfig[]) =>
      jobDimensions({
        roleFamilyKey: nextRole,
        primaryStack: nextStack,
        previous,
        custom: previous.filter((dimension) => dimension.custom),
        labelOf,
        describeOf,
      }),
    [labelOf, describeOf],
  );

  /** 换坐标后按同一总题数重新分配，避免族层维度换了却把题数丢光。 */
  const countsFor = useCallback(
    (nextDimensions: DimensionConfig[], previousTotal: number) =>
      normalizeQuestionCounts(
        nextDimensions,
        planQuestionCounts({
          general: nextDimensions.filter((dimension) => dimension.layer === 'general'),
          family: nextDimensions.filter((dimension) => dimension.layer !== 'general'),
          total: previousTotal,
        }),
      ),
    [],
  );

  // 每次打开都重置成当前岗位的值——不这么做的话，编辑完 A 再打开 B 会看到 A 的内容。
  useEffect(() => {
    if (!open) return;
    setTitle(job?.title ?? '');
    setJobDescription(job?.jobDescription ?? '');

    // 老岗位没有显式坐标，`normalizeJobCoordinates` 会按旧目录推导（岗位族、题数都在里面）。
    const coordinates = job ? normalizeJobCoordinates(job) : null;
    const initialRole = coordinates?.roleFamilyKey ?? 'other';
    const initialStack = coordinates?.primaryStack ?? 'none';

    setRoleFamilyKey(initialRole);
    setPrimaryStack(initialStack);
    // 新建岗位跟随 JD 自动识别；编辑已有岗位时尊重已保存的坐标。
    setRoleTouched(Boolean(job));
    setStackTouched(Boolean(job));
    setCountsTouched(false);

    const nextDimensions = dimensionsFor(initialRole, initialStack, coordinates?.dimensions ?? []);
    setDimensions(nextDimensions);
    setQuestionCounts(
      coordinates
        ? normalizeQuestionCounts(nextDimensions, coordinates.questionCounts)
        : countsFor(nextDimensions, QUESTION_COUNT_DEFAULT),
    );
  }, [open, job, dimensionsFor, countsFor]);

  // 新建岗位时，岗位名称/JD 一变就重新识别岗位族与语言栈。
  // 300ms 防抖：避免每敲一个字都重建维度、把用户正在看的滑块抖走。
  useEffect(() => {
    if (!open || (roleTouched && stackTouched)) return;

    const inferred = resolveRoleFamily({ jobTitle: title, jobDescription });
    const nextRole = roleTouched ? roleFamilyKey : inferred.roleFamily;
    const nextStack = stackTouched ? primaryStack : inferred.primaryStack;
    if (nextRole === roleFamilyKey && nextStack === primaryStack) return;

    const timer = window.setTimeout(() => {
      setRoleFamilyKey(nextRole);
      setPrimaryStack(nextStack);
      const nextDimensions = dimensionsFor(nextRole, nextStack, dimensions);
      setDimensions(nextDimensions);
      setQuestionCounts((current) =>
        countsTouched
          ? countsFor(nextDimensions, totalQuestions(current) || QUESTION_COUNT_DEFAULT)
          : countsFor(nextDimensions, QUESTION_COUNT_DEFAULT),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    open,
    title,
    jobDescription,
    roleTouched,
    stackTouched,
    roleFamilyKey,
    primaryStack,
    countsTouched,
    dimensions,
    dimensionsFor,
    countsFor,
  ]);

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
    if (next.roleFamilyKey) setRoleTouched(true);
    if (next.primaryStack) setStackTouched(true);
    if (nextFamily === roleFamilyKey && nextStack === primaryStack) return;

    setRoleFamilyKey(nextFamily);
    setPrimaryStack(nextStack);
    const previousTotal = totalQuestions(questionCounts) || QUESTION_COUNT_DEFAULT;
    const nextDimensions = dimensionsFor(nextFamily, nextStack, dimensions);
    setDimensions(nextDimensions);
    setQuestionCounts(countsFor(nextDimensions, previousTotal));
    setCountsTouched(false);
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
      // AI 识别结果是用户显式触发的，不再被自动识别覆盖。
      setRoleTouched(true);
      setStackTouched(true);
      setCountsTouched(true);
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
      // 自动识别有 300ms 防抖，用户输入完立刻点保存时状态可能还没跟上。
      // 在提交前再解析一次，保证落库的坐标与维度一致。
      const inferred = resolveRoleFamily({ jobTitle: title, jobDescription });
      const finalRole = roleTouched ? roleFamilyKey : inferred.roleFamily;
      const finalStack = stackTouched ? primaryStack : inferred.primaryStack;
      const coordinatesChanged = finalRole !== roleFamilyKey || finalStack !== primaryStack;
      const finalDimensions = coordinatesChanged
        ? dimensionsFor(finalRole, finalStack, dimensions)
        : dimensions;
      const finalCounts = coordinatesChanged
        ? countsFor(finalDimensions, totalQuestions(questionCounts) || QUESTION_COUNT_DEFAULT)
        : questionCounts;

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
          roleFamilyKey: finalRole,
          primaryStack: finalStack,
          dimensions: finalDimensions,
          questionCounts: finalCounts,
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
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{t('roleFamilyLabel')}</div>
                {roleTouched || stackTouched ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRoleTouched(false);
                      setStackTouched(false);
                    }}
                    className="cursor-pointer text-[11px] font-medium text-brand hover:underline"
                  >
                    {t('autoDetect')}
                  </button>
                ) : (
                  <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                    {t('autoDetectActive')}
                  </span>
                )}
              </div>
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
          <div className="-mt-2 space-y-1 text-xs text-zinc-500">
            <p>{roleTouched || stackTouched ? t('roleFamilyHint') : t('autoDetectHint')}</p>
            {roleFamilyKey === 'other' && (roleTouched || stackTouched) && (
              <p>{t('otherFamilyHint')}</p>
            )}
          </div>

          <DimensionChips
            value={dimensions}
            questionCounts={questionCounts}
            onChange={(nextDimensions, nextCounts) => {
              if (JSON.stringify(nextCounts) !== JSON.stringify(questionCounts)) {
                setCountsTouched(true);
              }
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
