'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Plus } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { InterviewerCard } from './interviewer-card';
import { CustomInterviewerDialog } from './custom-interviewer-dialog';
import { getPresetInterviewers } from '@/lib/interview/interviewers';
import type { InterviewerConfig } from '@/types/interview';

interface InterviewerPickerProps {
  selected: InterviewerConfig[];
  onChange: (selected: InterviewerConfig[]) => void;
}

/** 已选面试官：可拖拽排序，决定出场顺序。 */
function SortableInterviewer({ interviewer, index, onRemove }: {
  interviewer: InterviewerConfig;
  index: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: interviewer.type });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="touch-none"
      {...attributes}
      {...listeners}
    >
      <InterviewerCard interviewer={interviewer} selected onToggle={onRemove} index={index} />
    </div>
  );
}

export function InterviewerPicker({ selected, onChange }: InterviewerPickerProps) {
  const t = useTranslations('interview.setup');
  const locale = useLocale() as 'zh' | 'en';
  const presets = getPresetInterviewers(locale);

  const selectedTypes = new Set(selected.map((s) => s.type));
  const available = [
    ...presets,
    ...selected.filter((s) => s.type.startsWith('custom_')),
  ].filter((interviewer) => !selectedTypes.has(interviewer.type));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggleInterviewer = (interviewer: InterviewerConfig) => {
    const exists = selected.find((s) => s.type === interviewer.type);
    if (exists) {
      onChange(selected.filter((s) => s.type !== interviewer.type));
    } else {
      onChange([...selected, interviewer]);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = selected.findIndex((s) => s.type === active.id);
    const newIndex = selected.findIndex((s) => s.type === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(selected, oldIndex, newIndex));
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold text-white ${selected.length > 0 ? 'bg-brand' : 'bg-zinc-400 dark:bg-zinc-600'}`}>3</span>
        {t('interviewerLabel')}
      </div>

      {selected.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={selected.map((s) => s.type)} strategy={horizontalListSortingStrategy}>
            <div className="mb-2 flex gap-2 overflow-x-auto pb-2">
              {selected.map((interviewer, index) => (
                <SortableInterviewer
                  key={interviewer.type}
                  interviewer={interviewer}
                  index={index}
                  onRemove={() => toggleInterviewer(interviewer)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2">
        {available.map((interviewer) => (
          <InterviewerCard
            key={interviewer.type}
            interviewer={interviewer}
            selected={false}
            onToggle={() => toggleInterviewer(interviewer)}
          />
        ))}
        <CustomInterviewerDialog
          onAdd={(config) => onChange([...selected, config])}
          trigger={
            <div className="flex min-w-[100px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-3 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50">
              <Plus className="h-5 w-5 text-zinc-300 dark:text-zinc-600" />
              <span className="mt-1 text-[10px] text-zinc-400">{t('customInterviewer')}</span>
            </div>
          }
        />
      </div>
    </div>
  );
}
