/** The trigger message sent to start a round */
export const TIMEOUT_MESSAGE = '[系统] 本题超时，进入下一题。';

/** Messages that should be hidden from the chat UI */
export const HIDDEN_MESSAGES = new Set([
  '你好，我准备好了，请开始面试。',
  '[系统] 本题超时，进入下一题。',
]);

/**
 * `/interview/[id]` 与 `/interview/perspective` 等静态段同层。
 * Next.js 中静态段优先，但这些名字不能被当成 session id——
 * 逐个从动态路由里挡掉，避免理论上撞上时静默取错东西。
 */
export const RESERVED_INTERVIEW_SEGMENTS = new Set([
  'perspective',
  'new',
  'history',
  'profile',
  'weak-questions',
  'retry',
]);

export function isReservedInterviewSegment(id: string): boolean {
  return RESERVED_INTERVIEW_SEGMENTS.has(id);
}

/** The trigger message sent to start a round */
export const INIT_TRIGGER = '你好，我准备好了，请开始面试。';

/** Messages triggered by control actions — shown with special tags */
export const HINT_MESSAGE = '这个问题我不太确定方向，能给我一些思路上的引导吗？';
export const SKIP_MESSAGE = '这个问题我暂时没有太好的思路，能换一个问题吗？';
