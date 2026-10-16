'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bookmark, Lightbulb, SkipForward } from 'lucide-react';
import { useInterviewStore } from '@/stores/interview-store';
import type { InterviewMessageMetadata, InterviewerConfig } from '@/types/interview';

interface InterviewerMessageProps {
  content: string;
  config: InterviewerConfig;
  messageId?: string;
  metadata?: InterviewMessageMetadata;
}

export function InterviewerMessage({ content, messageId, metadata }: InterviewerMessageProps) {
  const flags = useInterviewStore((state) => (messageId ? state.messageFlags[messageId] : undefined));
  const isMarked = flags?.marked ?? metadata?.marked ?? false;
  const isHinted = flags?.hinted ?? metadata?.hinted ?? false;
  const isSkipped = flags?.skipped ?? metadata?.skipped ?? false;
  const displayContent = content.replace(/\[ROUND_COMPLETE\]/g, '').trim();

  return (
    <div className="max-w-[85%]">
      <div className="rounded-r-2xl border-l-[3px] border-brand bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
        </div>
        {(isMarked || isHinted || isSkipped) && (
          <div className="mt-2 flex gap-2 text-zinc-400">
            {isMarked && <Bookmark className="h-3 w-3 text-yellow-500" />}
            {isHinted && <Lightbulb className="h-3 w-3 text-amber-500" />}
            {isSkipped && <SkipForward className="h-3 w-3" />}
          </div>
        )}
      </div>
    </div>
  );
}
