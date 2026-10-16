import { create } from 'zustand';
import type {
  InterviewSession,
  InterviewRound,
  InterviewReport,
  InterviewMessageMetadata,
} from '@/types/interview';

interface InterviewStore {
  currentSession: InterviewSession | null;
  rounds: InterviewRound[];
  currentRoundIndex: number;
  status: 'idle' | 'preparing' | 'in_progress' | 'paused' | 'completed';
  /**
   * 控制标记（标记/提示/跳过）按消息 id 存放。
   *
   * 乐观更新在前、服务端返回后以服务端为准；刷新时由 DB 里的
   * `interview_messages.metadata` 重新灌入。
   */
  messageFlags: Record<string, InterviewMessageMetadata>;
  report: InterviewReport | null;
  isGeneratingReport: boolean;

  setSession: (session: InterviewSession, rounds: InterviewRound[]) => void;
  setStatus: (status: InterviewStore['status']) => void;
  setCurrentRoundIndex: (index: number) => void;
  advanceToNextRound: () => void;
  updateRound: (roundId: string, updates: Partial<InterviewRound>) => void;
  setMessageFlags: (messageId: string, patch: InterviewMessageMetadata) => void;
  hydrateMessageFlags: (flags: Record<string, InterviewMessageMetadata>) => void;
  setReport: (report: InterviewReport) => void;
  setIsGeneratingReport: (v: boolean) => void;
  reset: () => void;
}

const initialState = {
  currentSession: null,
  rounds: [] as InterviewRound[],
  currentRoundIndex: 0,
  status: 'idle' as const,
  messageFlags: {} as Record<string, InterviewMessageMetadata>,
  report: null,
  isGeneratingReport: false,
};

export const useInterviewStore = create<InterviewStore>((set, get) => ({
  ...initialState,

  setSession: (session, rounds) =>
    set({
      currentSession: session,
      rounds,
      currentRoundIndex: session.currentRound ?? 0,
      status: session.status as InterviewStore['status'],
      messageFlags: {},
      report: null,
      isGeneratingReport: false,
    }),

  setStatus: (status) => set({ status }),

  setCurrentRoundIndex: (index) => set({ currentRoundIndex: index }),

  advanceToNextRound: () => {
    const { currentRoundIndex, rounds } = get();
    const nextIndex = currentRoundIndex + 1;
    if (nextIndex < rounds.length) {
      set({ currentRoundIndex: nextIndex });
    }
  },

  updateRound: (roundId, updates) =>
    set((state) => ({
      rounds: state.rounds.map((r) => (r.id === roundId ? { ...r, ...updates } : r)),
    })),

  setMessageFlags: (messageId, patch) =>
    set((state) => ({
      messageFlags: {
        ...state.messageFlags,
        [messageId]: { ...state.messageFlags[messageId], ...patch },
      },
    })),

  hydrateMessageFlags: (flags) => set({ messageFlags: flags }),

  setReport: (report) => set({ report }),
  setIsGeneratingReport: (v) => set({ isGeneratingReport: v }),

  reset: () => set({ ...initialState, messageFlags: {} }),
}));
