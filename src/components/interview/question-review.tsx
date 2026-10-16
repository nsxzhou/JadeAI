'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Star, Bookmark, Lightbulb, SkipForward, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { QuestionEvaluation } from '@/types/interview';

interface QuestionReviewProps {
  evaluation: QuestionEvaluation;
  index: number;
}

export function QuestionReview({ evaluation, index }: QuestionReviewProps) {
  const t = useTranslations('interview.report');
  const [showAnswer, setShowAnswer] = useState(false);

  return (
    <div className="rounded-md border p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-500">Q{index + 1}</span>
        <div className="flex gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={cn('h-3 w-3', i < Math.round(evaluation.score / 20) ? 'fill-yellow-400 text-yellow-400' : 'text-zinc-200')}
            />
          ))}
        </div>
        {evaluation.marked && (
          <Badge variant="outline" className="text-xs text-yellow-600">
            <Bookmark className="mr-1 h-3 w-3" />
            {t('markedForReview')}
          </Badge>
        )}
        {evaluation.hinted && (
          <Badge variant="outline" className="text-xs text-amber-600">
            <Lightbulb className="mr-1 h-3 w-3" />
            {t('usedHint')}
          </Badge>
        )}
        {evaluation.skipped && (
          <Badge variant="outline" className="text-xs text-zinc-500">
            <SkipForward className="mr-1 h-3 w-3" />
            {t('skippedQuestion')}
          </Badge>
        )}
      </div>
      <p className="mb-2 text-sm font-medium">{evaluation.question}</p>
      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{evaluation.answerSummary}</p>
      {evaluation.answer?.trim() && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setShowAnswer((value) => !value)}
            className="flex cursor-pointer items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            {showAnswer ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {t('originalAnswer')}
          </button>
          {showAnswer && (
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
              {evaluation.answer}
            </p>
          )}
        </div>
      )}
      {evaluation.highlights.length > 0 && (
        <div className="mb-1">
          <span className="text-xs font-medium text-green-600">{t('highlights')}:</span>
          <ul className="ml-4 list-disc text-xs text-zinc-600">{evaluation.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
        </div>
      )}
      {evaluation.weaknesses.length > 0 && (
        <div className="mb-1">
          <span className="text-xs font-medium text-red-600">{t('weaknesses')}:</span>
          <ul className="ml-4 list-disc text-xs text-zinc-600">{evaluation.weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      <div>
        <span className="text-xs font-medium text-blue-600">{t('reference')}:</span>
        <p className="text-xs text-zinc-500">{evaluation.referenceTips ?? ''}</p>
      </div>
    </div>
  );
}
