import type { InterviewSessionStatus } from '@/types/interview';

export type SessionStatusAction = 'pause' | 'resume';

/**
 * 暂停 / 恢复的状态迁移。
 *
 * - 已完成（completed）的面试不能再被暂停或恢复，返回 null 由调用方拒绝；
 * - 其余状态都可幂等地迁到目标状态：暂停 -> paused，恢复 -> in_progress。
 *
 * 抽成纯函数是因为状态迁移是「暂停没反应」的根因所在：服务端已经写库，
 * 前端却还按旧状态渲染。把规则放在一处，路由与测试共用。
 */
export function nextSessionStatus(
  current: InterviewSessionStatus,
  action: SessionStatusAction,
): InterviewSessionStatus | null {
  if (current === 'completed') return null;
  return action === 'pause' ? 'paused' : 'in_progress';
}
