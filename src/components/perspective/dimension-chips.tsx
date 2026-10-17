'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Plus, Check, Pencil, Sparkles, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { dimensionColor } from '@/lib/perspective/dimension-colors';
import { QUESTION_COUNT_PER_DIMENSION_MAX } from '@/types/perspective';
import { cn } from '@/lib/utils';
import type { DimensionConfig } from '@/types/perspective';

interface DimensionChipsProps {
  value: DimensionConfig[];
  /** 逐维度题数；key 与 `value` 一一对应 */
  questionCounts: Record<string, number>;
  onChange: (dimensions: DimensionConfig[], questionCounts: Record<string, number>) => void;
  /** 该岗位族 + 语言栈下的预置维度 key（通用层在前） */
  presetKeys: string[];
  onAIRecognize?: () => void;
  aiRecognizing?: boolean;
}

/**
 * 维度配置：**题数与评分权重彻底分开**。
 *
 * - 通用层 4 维恒在、不可移除（两层坐标可比的前提），题数至少 1；
 * - 族层维度来自岗位族，可以关掉（题数 0），滑块直接设「出几道题」；
 * - 自定义维度保留但它只参与本场评分，不进能力画像。
 */
export function DimensionChips({
  value,
  questionCounts,
  onChange,
  presetKeys,
  onAIRecognize,
  aiRecognizing = false,
}: DimensionChipsProps) {
  const t = useTranslations('perspective.dimensions');
  const [customName, setCustomName] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  /** 正在编辑考察重点的维度 key，一次只开一个，不然弹窗高度失控 */
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const selectedByKey = new Map(value.map((dimension) => [dimension.key, dimension]));
  const editing = editingKey ? selectedByKey.get(editingKey) : undefined;
  const total = value.reduce((sum, dimension) => sum + (questionCounts[dimension.key] ?? 0), 0);

  function emit(next: DimensionConfig[], counts: Record<string, number>) {
    const keys = new Set(next.map((dimension) => dimension.key));
    onChange(
      next,
      Object.fromEntries(Object.entries(counts).filter(([key]) => keys.has(key))),
    );
  }

  function togglePreset(key: string) {
    if (selectedByKey.has(key)) {
      const current = selectedByKey.get(key);
      // 通用层恒定覆盖，不允许移除
      if (current?.layer === 'general') return;
      emit(
        value.filter((dimension) => dimension.key !== key),
        questionCounts,
      );
      if (editingKey === key) setEditingKey(null);
      return;
    }
    emit(
      [...value, {
        key,
        label: t(key),
        description: t(`descriptions.${key}`),
        layer: 'family',
        weight: 2,
        custom: false,
      }],
      { ...questionCounts, [key]: 1 },
    );
  }

  function patchDimension(key: string, data: Partial<DimensionConfig>) {
    onChange(
      value.map((dimension) => (dimension.key === key ? { ...dimension, ...data } : dimension)),
      questionCounts,
    );
  }

  function patchCount(key: string, count: number) {
    onChange(value, { ...questionCounts, [key]: count });
  }

  function addCustom() {
    const name = customName.trim();
    const description = customDescription.trim();
    if (!name || !description || selectedByKey.has(name)) return;
    emit(
      [...value, {
        key: name,
        label: name,
        description,
        layer: 'family',
        weight: 2,
        custom: true,
      }],
      { ...questionCounts, [name]: 2 },
    );
    setCustomName('');
    setCustomDescription('');
    setCustomOpen(false);
  }

  function remove(key: string) {
    emit(
      value.filter((dimension) => dimension.key !== key),
      questionCounts,
    );
    if (editingKey === key) setEditingKey(null);
  }

  const generalKeys = value.filter((dimension) => dimension.layer === 'general').map((dimension) => dimension.key);
  const familyPresetKeys = presetKeys.filter((key) => !generalKeys.includes(key));

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm font-medium">{t('title')}</Label>
          {onAIRecognize && (
            <Button type="button" variant="outline" size="sm" onClick={onAIRecognize} disabled={aiRecognizing} className="cursor-pointer gap-1.5">
              {aiRecognizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {aiRecognizing ? t('recognizing') : t('aiRecognize')}
            </Button>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">{t('hint')}</p>
        <p className="mt-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t('totalQuestions', { count: total })}
        </p>
      </div>

      {/* 通用层：恒在，不可移除 */}
      <div>
        <p className="mb-1.5 text-[11px] uppercase tracking-wide text-zinc-400">{t('generalLayer')}</p>
        <div className="flex flex-wrap gap-2">
          {value
            .filter((dimension) => dimension.layer === 'general')
            .map((dimension) => (
              <span
                key={dimension.key}
                className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand/10 px-3 py-1.5 text-sm text-brand"
                title={t('generalLocked')}
              >
                <Lock className="h-3 w-3" />
                {t(dimension.key)}
              </span>
            ))}
        </div>
      </div>

      {/* 族层：按岗位族给的可选清单 */}
      <div>
        <p className="mb-1.5 text-[11px] uppercase tracking-wide text-zinc-400">{t('familyLayer')}</p>
        <div className="flex flex-wrap gap-2">
          {familyPresetKeys.map((key) => {
            const selected = selectedByKey.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => togglePreset(key)}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  selected
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300',
                )}
              >
                {selected && <Check className="h-3.5 w-3.5" />}
                {t(key)}
              </button>
            );
          })}
          {value
            .filter((dimension) => dimension.custom)
            .map((dimension) => (
              <span
                key={dimension.key}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand bg-brand/10 px-3 py-1.5 text-sm text-brand"
              >
                {dimension.label}
                <button type="button" onClick={() => remove(dimension.key)} className="cursor-pointer" aria-label={dimension.label}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">{t('customHint')}</p>
      </div>

      {/* 题数滑块：每维几道题，与评分权重无关 */}
      {value.length > 0 && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-lg border bg-zinc-50 p-4 sm:grid-cols-2 dark:bg-zinc-900">
          {value.map((dimension) => {
            const count = questionCounts[dimension.key] ?? 0;
            const min = dimension.layer === 'general' ? 1 : 0;
            return (
              <div key={dimension.key} className="flex items-center gap-2.5">
                {/* 和题目列表里的小圆点同色，配色即维度 */}
                <span className={cn('h-2 w-2 shrink-0 rounded-full', dimensionColor(dimension.key).dot)} aria-hidden />
                <span className="w-14 shrink-0 truncate text-xs text-zinc-600 dark:text-zinc-400" title={dimension.label}>
                  {dimension.custom ? dimension.label : t(dimension.key)}
                </span>
                <Slider
                  className="min-w-0 flex-1 cursor-pointer"
                  min={min}
                  max={QUESTION_COUNT_PER_DIMENSION_MAX}
                  step={1}
                  value={[count]}
                  onValueChange={([next]) => patchCount(dimension.key, next)}
                />
                <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-zinc-600">
                  {t('perDimension', { count })}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingKey(editingKey === dimension.key ? null : dimension.key)}
                  aria-label={t('editDescription')}
                  title={dimension.description}
                  className={cn(
                    'shrink-0 cursor-pointer rounded p-1 transition-colors',
                    editingKey === dimension.key
                      ? 'text-brand'
                      : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                  )}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 考察重点编辑区：一次只展开一个，放在网格下面而不是每行内嵌 */}
      {editing && (
        <div className="space-y-1.5 rounded-lg border border-brand/40 bg-brand/5 p-3">
          <Label htmlFor="dimension-description" className="text-xs font-medium">
            {t('descriptionLabel')} · {editing.label}
          </Label>
          <Textarea
            id="dimension-description"
            value={editing.description ?? ''}
            onChange={(event) => patchDimension(editing.key, { description: event.target.value })}
            placeholder={t('descriptionPlaceholder')}
            className="max-h-[200px] min-h-[96px] bg-white dark:bg-zinc-900"
          />
          <p className="text-[11px] text-zinc-500">{t('descriptionHint')}</p>
        </div>
      )}

      {/* 自定义维度默认收起：描述是必填的，展开后是两行表单 */}
      {customOpen ? (
        <div className="space-y-2 rounded-lg border p-3">
          <Input
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            placeholder={t('customPlaceholder')}
            autoFocus
          />
          <Textarea
            value={customDescription}
            onChange={(event) => setCustomDescription(event.target.value)}
            placeholder={t('descriptionPlaceholder')}
            className="max-h-[200px] min-h-[80px]"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-500">{t('descriptionHint')}</p>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCustomOpen(false)} className="cursor-pointer">
                <X className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={addCustom}
                disabled={!customName.trim() || !customDescription.trim() || selectedByKey.has(customName.trim())}
                className="cursor-pointer gap-1.5 bg-brand hover:bg-brand-hover"
              >
                <Plus className="h-4 w-4" />
                {t('addCustom')}
              </Button>
            </div>
          </div>
          {customName.trim() && !customDescription.trim() && (
            <p className="text-[11px] text-amber-600">{t('customDescriptionRequired')}</p>
          )}
          {customName.trim() && selectedByKey.has(customName.trim()) && (
            <p className="text-[11px] text-amber-600">{t('duplicate')}</p>
          )}
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setCustomOpen(true)} className="cursor-pointer gap-1.5">
          <Plus className="h-4 w-4" />
          {t('addCustom')}
        </Button>
      )}

      {value.length === 0 && <p className="text-sm text-red-500">{t('atLeastOne')}</p>}
    </div>
  );
}
