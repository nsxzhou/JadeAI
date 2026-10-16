/**
 * 面试进度。
 *
 * `currentRoundIndex` 是「正在进行的轮次下标」，所以已完成轮数就等于它：
 * 在建会话后的第 0 轮里，完成数是 0 而不是 1——旧的 `0/N 轮` 之所以看着像
 * off-by-one，是因为把「正在进行第几轮」当成了「已完成几轮」。这个函数把
 * 语义固定下来，卡片与大厅都只从这里取数。
 */
export interface InterviewProgress {
  /** 已完成的轮数，0 表示第一轮还没结束 */
  completedRounds: number;
  totalRounds: number;
  /** 已完成轮数占比，0-100 */
  percent: number;
  isComplete: boolean;
}

export function computeInterviewProgress(input: {
  status: string;
  currentRoundIndex: number;
  totalRounds: number;
}): InterviewProgress {
  const totalRounds = Math.max(0, Math.floor(input.totalRounds));
  const isComplete = input.status === 'completed';

  if (totalRounds === 0) {
    return { completedRounds: 0, totalRounds: 0, percent: 0, isComplete };
  }

  const completedRounds = isComplete
    ? totalRounds
    : Math.min(Math.max(Math.floor(input.currentRoundIndex), 0), totalRounds);

  return {
    completedRounds,
    totalRounds,
    percent: Math.round((completedRounds / totalRounds) * 100),
    isComplete,
  };
}
