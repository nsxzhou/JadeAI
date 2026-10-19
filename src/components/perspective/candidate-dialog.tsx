'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, Loader2, Check, FileText, X } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/routing';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useFingerprint } from '@/hooks/use-fingerprint';
import { getAIHeaders } from '@/stores/settings-store';
import { cn } from '@/lib/utils';
import {
  CandidateSetupError,
  runCandidateSetup,
  type CandidateSetupProgress,
} from '@/lib/perspective/candidate-setup-flow';
import { consumeQuestionGenerationStream } from '@/lib/perspective/generation-client';
import {
  generationProgressPercent,
  type GenerationProgress,
} from '@/lib/perspective/generation-progress';
import type { CandidateSummary } from '@/types/perspective';
import type { Resume } from '@/types/resume';

type Step = 'create' | 'resume' | 'questions';
type ResumeSource = 'library' | 'import';
type ResumeFailure = 'library' | 'parse' | 'save';
type ResumeOption = Pick<Resume, 'id' | 'title' | 'updatedAt'>;
const STEPS: Step[] = ['create', 'resume', 'questions'];

interface CandidateDialogProps {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入表示给已有候选人重传简历，不传表示新建 */
  candidate?: CandidateSummary | null;
  /** 建完但还没跳走时通知列表刷新 */
  onDone?: () => void;
}

/**
 * 一个弹窗跑完「建人 → 传简历 → 出题 → 进面试台」。
 *
 * 拆成准备页的时候，用户要点四次才能开始面试；这四步之间其实
 * 没有任何需要人做决定的地方，所以合并成一次提交，中间只报进度。
 */
export function CandidateDialog({
  jobId,
  open,
  onOpenChange,
  candidate,
  onDone,
}: CandidateDialogProps) {
  const t = useTranslations('perspective');
  const router = useRouter();
  const { fingerprint, isLoading: fingerprintLoading } = useFingerprint();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<CandidateSetupProgress>({
    candidateId: candidate?.id ?? null,
    resumeSaved: false,
  });
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);

  const editing = Boolean(candidate);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [running, setRunning] = useState<Step | null>(null);
  const [failedAt, setFailedAt] = useState<Step | null>(null);
  const [resumeSource, setResumeSource] = useState<ResumeSource>('library');
  const [libraryResumeId, setLibraryResumeId] = useState<string | undefined>(undefined);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [resumesLoading, setResumesLoading] = useState(false);
  const resumeFailureRef = useRef<ResumeFailure | null>(null);
  const autoNameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(candidate?.name ?? '');
    setFile(null);
    setText('');
    setRunning(null);
    setFailedAt(null);
    setResumeSource('library');
    setLibraryResumeId(undefined);
    resumeFailureRef.current = null;
    autoNameRef.current = null;
    setProgress({ candidateId: candidate?.id ?? null, resumeSaved: false });
    setGenerationProgress(null);
  }, [open, candidate]);

  // 简历库只在弹窗打开时拉一次；复用 App 里已经创建好的简历，而不是逼用户重新上传。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setResumesLoading(true);
    // useFingerprint 首次计算完成前，先读 localStorage，避免无谓的 401 造成空列表闪烁。
    const fp = fingerprint ?? (typeof window !== 'undefined' ? localStorage.getItem('jade_fingerprint') : null);
    fetch('/api/resume', { headers: fp ? { 'x-fingerprint': fp } : {} })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setResumes(Array.isArray(data) ? (data as ResumeOption[]) : []);
      })
      .catch(() => {
        if (!cancelled) setResumes([]);
      })
      .finally(() => {
        if (!cancelled) setResumesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fingerprint]);

  const libraryLoading = resumesLoading || fingerprintLoading;
  const hasLibraryResume = Boolean(libraryResumeId);
  const hasImportResume = Boolean(file) || Boolean(text.trim());
  const hasResume =
    progress.resumeSaved || (resumeSource === 'library' ? hasLibraryResume : hasImportResume);
  const canSubmit = (editing || name.trim()) && hasResume && running === null;
  const createdInThisFlow = !editing && Boolean(progress.candidateId);
  const resumeLocked = progress.resumeSaved;

  const headers = (): Record<string, string> =>
    fingerprint ? { 'x-fingerprint': fingerprint } : {};

  const handlePickResume = (id: string) => {
    setLibraryResumeId(id);
    if (editing) return;
    // 名字空着、或还是上一次自动填的标题时，跟着当前选择的简历更新。
    const picked = resumes.find((resume) => resume.id === id);
    if (!picked) return;
    const canAutoFill = !name.trim() || name === autoNameRef.current;
    if (canAutoFill) {
      setName(picked.title);
      autoNameRef.current = picked.title;
    }
  };

  async function handleSubmit() {
    setFailedAt(null);
    setGenerationProgress(null);
    resumeFailureRef.current = null;

    if (candidate?.id && name.trim() && name.trim() !== candidate.name) {
      await fetch(`/api/perspective/candidates/${candidate.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...headers() },
        body: JSON.stringify({ name: name.trim() }),
      }).catch(() => {});
    }

    try {
      const completed = await runCandidateSetup(progress, {
        onStep: setRunning,
        createCandidate: async () => {
          const res = await fetch(`/api/perspective/jobs/${jobId}/candidates`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers() },
            body: JSON.stringify({ name: name.trim() }),
          });
          if (!res.ok) throw new Error('create failed');
          return (await res.json()).candidate.id as string;
        },
        saveResume: async (candidateId) => {
          if (resumeSource === 'library') {
            if (!libraryResumeId) throw new Error('no resume selected');
            resumeFailureRef.current = 'library';
            const res = await fetch(`/api/perspective/candidates/${candidateId}/resume`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...headers() },
              body: JSON.stringify({ resumeId: libraryResumeId }),
            });
            if (!res.ok) throw new Error('library resume save failed');
            return;
          }

          if (file) {
            resumeFailureRef.current = 'parse';
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch(`/api/perspective/candidates/${candidateId}/resume`, {
              method: 'POST',
              headers: { ...headers(), ...getAIHeaders() },
              body: fd,
            });
            if (!res.ok) throw new Error('resume parse failed');
            return;
          }

          resumeFailureRef.current = 'save';
          const res = await fetch(`/api/perspective/candidates/${candidateId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', ...headers() },
            body: JSON.stringify({ resumeText: text.trim() }),
          });
          if (!res.ok) throw new Error('resume save failed');
        },
        generateQuestions: async (candidateId) => {
          const res = await fetch(`/api/perspective/candidates/${candidateId}/questions`, {
            method: 'POST',
            headers: { ...headers(), ...getAIHeaders() },
          });
          // 接口返回 NDJSON 进度流；失败时 consume 会抛出可展示的 Error。
          await consumeQuestionGenerationStream(res, setGenerationProgress);
        },
      });

      setProgress(completed);
      const candidateId = completed.candidateId;
      if (!candidateId) throw new Error('candidate id missing after setup');
      onOpenChange(false);
      router.push(`/interview/perspective/${jobId}/c/${candidateId}/stage`);
    } catch (error) {
      setRunning(null);
      if (!(error instanceof CandidateSetupError)) {
        toast.error(t('errors.saveFailed'));
        return;
      }

      setProgress(error.progress);
      setFailedAt(error.step);
      if (error.progress.candidateId) onDone?.();

      const failureKey =
        error.step === 'create'
          ? 'errors.saveFailed'
          : error.step === 'questions'
            ? 'errors.generateFailed'
            : resumeFailureRef.current === 'library'
              ? 'errors.resumeUnavailable'
              : resumeFailureRef.current === 'save'
                ? 'errors.saveFailed'
                : 'errors.parseFailed';
      toast.error(t(failureKey), {
        description:
          failureKey === 'errors.generateFailed' ? t('errors.generateFailedHint') : undefined,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => running === null && onOpenChange(o)}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
        showCloseButton={running === null}
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? t('addFlow.reupload') : t('addFlow.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cand-name">{t('candidates.name')}</Label>
            <Input
              id="cand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('candidates.namePlaceholder')}
              disabled={running !== null || createdInThisFlow}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('addFlow.resumeLabel')}</Label>
            <Tabs
              value={resumeSource}
              onValueChange={(value) => setResumeSource(value as ResumeSource)}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="library" disabled={running !== null || resumeLocked}>
                  {t('resume.libraryTab')}
                </TabsTrigger>
                <TabsTrigger value="import" disabled={running !== null || resumeLocked}>
                  {t('resume.importTab')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="library" className="space-y-2 pt-2">
                {libraryLoading ? (
                  <Skeleton className="h-9 w-full rounded-lg" />
                ) : resumes.length > 0 ? (
                  <>
                    <Select
                      value={libraryResumeId}
                      onValueChange={handlePickResume}
                      disabled={running !== null || resumeLocked}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('resume.libraryPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {resumes.map((resume) => (
                          <SelectItem key={resume.id} value={resume.id}>
                            {resume.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-zinc-500">{t('resume.libraryHint')}</p>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed px-3 py-4 text-center dark:border-zinc-700">
                    <p className="text-xs text-zinc-500">{t('resume.libraryEmpty')}</p>
                    <Link
                      href="/dashboard"
                      className="mt-1 inline-block text-xs font-medium text-brand hover:underline"
                    >
                      {t('resume.libraryCreate')}
                    </Link>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="import" className="space-y-4 pt-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setFile(f);
                      setText('');
                    }
                    // 清空，否则同一个文件重选不触发 change
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                />
                {file ? (
                  <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 dark:border-zinc-800">
                    <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      disabled={running !== null || resumeLocked}
                      aria-label={t('cancel')}
                      className="shrink-0 cursor-pointer text-zinc-400 hover:text-zinc-700 disabled:opacity-40 dark:hover:text-zinc-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={running !== null || resumeLocked}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-3 py-3 text-left transition-colors hover:border-brand disabled:opacity-40 dark:border-zinc-700"
                  >
                    <Upload className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{t('resume.upload')}</span>
                      <span className="block text-xs text-zinc-500">{t('resume.uploadHint')}</span>
                    </span>
                  </button>
                )}

                {!file && (
                  <div className="space-y-1.5">
                    <Label htmlFor="cand-resume" className="text-xs font-normal text-zinc-500">
                      {t('resume.paste')}
                    </Label>
                    <Textarea
                      id="cand-resume"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={t('resume.pastePlaceholder')}
                      disabled={running !== null || resumeLocked}
                      className="max-h-[220px] min-h-[92px]"
                    />
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {(running !== null || failedAt !== null) && (
            <div className="space-y-1.5 rounded-lg border bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
              {STEPS.map((step) => {
                const order = STEPS.indexOf(step);
                const at = STEPS.indexOf(failedAt ?? running ?? 'create');
                const state =
                  order < at ? 'done' : order > at ? 'todo' : failedAt ? 'failed' : 'running';
                return (
                  <div key={step} className="flex items-center gap-2 text-[13px]">
                    {state === 'done' && <Check className="h-3.5 w-3.5 text-brand" />}
                    {state === 'running' && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                    )}
                    {state === 'failed' && <X className="h-3.5 w-3.5 text-red-600" />}
                    {state === 'todo' && (
                      <span className="h-3.5 w-3.5 rounded-full border border-zinc-300 dark:border-zinc-600" />
                    )}
                    <span
                      className={cn(
                        state === 'todo' && 'text-zinc-400',
                        state === 'failed' && 'text-red-600',
                        state === 'running' && 'text-zinc-900 dark:text-zinc-100',
                        state === 'done' && 'text-zinc-500',
                      )}
                    >
                      {t(`addFlow.step${step === 'create' ? 'Create' : step === 'resume' ? 'Resume' : 'Questions'}`)}
                    </span>
                  </div>
                );
              })}

              {running === 'questions' && generationProgress && (
                <div className="space-y-1 border-t border-zinc-200/70 pt-2 dark:border-zinc-800">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>{t(`addFlow.phases.${generationProgress.phase}`)}</span>
                    <span className="tabular-nums">
                      {generationProgress.completed}/{generationProgress.total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-brand transition-[width] duration-300"
                      style={{ width: `${generationProgressPercent(generationProgress)}%` }}
                    />
                  </div>
                  {generationProgress.retry && (
                    <p className="text-[11px] text-zinc-500">{t('addFlow.retrying')}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={running !== null}
            className="cursor-pointer"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            title={hasResume ? undefined : t('addFlow.needResumeFirst')}
            className="cursor-pointer gap-2"
          >
            {running !== null && <Loader2 className="h-4 w-4 animate-spin" />}
            {failedAt
              ? t('addFlow.retry')
              : editing
                ? t('addFlow.reuploadSubmit')
                : t('addFlow.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
