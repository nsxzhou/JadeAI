import { getAIHeaders } from '@/stores/settings-store';
import type { InterviewMessageMetadata, InterviewSessionStatus } from '@/types/interview';

export type InterviewControlAction = 'mark' | 'hint' | 'skip' | 'end_round' | 'pause' | 'resume';

export interface InterviewControlResult {
  ok: boolean;
  status?: InterviewSessionStatus;
  metadata?: InterviewMessageMetadata;
  systemMessage?: string;
  /** 服务端返回的 HTTP 状态码，便于区分 409（状态已变化）与网络失败 */
  statusCode?: number;
  error?: string;
  code?: string;
}

/**
 * 面试控制指令的统一客户端入口。
 *
 * 所有调用方都拿服务端返回的状态 / metadata 回写本地 store，而不是自己猜：
 * 暂停、恢复、跳过这些动作一旦前端与数据库不一致，界面就会「点完没反应」。
 */
export async function postInterviewControl(
  sessionId: string,
  action: InterviewControlAction,
  extra: Record<string, unknown> = {},
): Promise<InterviewControlResult> {
  if (typeof window === 'undefined') return { ok: false };

  const fp = localStorage.getItem('jade_fingerprint');
  try {
    const res = await fetch(`/api/interview/${sessionId}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(fp ? { 'x-fingerprint': fp } : {}),
        ...getAIHeaders(),
      },
      body: JSON.stringify({ action, ...extra }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status,
        error: typeof data?.error === 'string' ? data.error : undefined,
        code: typeof data?.code === 'string' ? data.code : undefined,
        status: typeof data?.status === 'string' ? (data.status as InterviewSessionStatus) : undefined,
      };
    }

    return {
      ok: true,
      status: typeof data?.status === 'string' ? (data.status as InterviewSessionStatus) : undefined,
      metadata: data?.metadata as InterviewMessageMetadata | undefined,
      systemMessage: typeof data?.systemMessage === 'string' ? data.systemMessage : undefined,
    };
  } catch {
    return { ok: false };
  }
}
