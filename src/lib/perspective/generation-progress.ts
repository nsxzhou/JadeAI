/**
 * 出题进度的线上协议。
 *
 * 题目生成已经不是一次模型调用，而是「蓝图 → 分批出题 → 质量校验 → 落库」，
 * 17 题可能要几十秒。前端需要知道现在走到哪一步、已完成几题，而不是只转一个
 * 没有信息的 spinner。
 *
 * 传输格式是 NDJSON：每行一个事件。客户端按行解析，服务端按阶段 enqueue。
 */

export type GenerationPhase = 'blueprint' | 'questions' | 'quality' | 'saving';

export interface GenerationProgress {
  type: 'progress';
  phase: GenerationPhase;
  /** 已完成题目数；蓝图阶段固定为 0 */
  completed: number;
  /** 本场总题数 */
  total: number;
  /** 这一条是「重试」而不是正常进度 */
  retry?: boolean;
  /** 后端给出的可选说明，前端可忽略 */
  message?: string;
}

export interface GenerationResult {
  type: 'result';
  candidate: unknown;
}

export interface GenerationError {
  type: 'error';
  /** 已脱敏、可直接展示给用户的错误 */
  error: string;
}

export type GenerationEvent = GenerationProgress | GenerationResult | GenerationError;

/**
 * 把分阶段进度折成一条 0–100 的整体进度条。
 *
 * 蓝图阶段没有题数进度，给 6%；出题占 10–90%；质量校验 92%；保存 98%。
 * 这样从蓝图切到出题时不会从 8% 倒回 0%，用户看到的是一条只向前的进度。
 */
export function generationProgressPercent(progress: GenerationProgress | null): number {
  if (!progress) return 0;
  switch (progress.phase) {
    case 'blueprint':
      return 6;
    case 'questions': {
      const ratio = progress.total > 0 ? progress.completed / progress.total : 0;
      return 10 + Math.round(Math.min(1, Math.max(0, ratio)) * 80);
    }
    case 'quality':
      return 92;
    case 'saving':
      return 98;
    default:
      return 0;
  }
}
