/**
 * 提交即定：已经提交的回答不可回改。
 *
 * 唯一允许的修改是用户手动标记「这题我答得不好」——那是标注，不是改答案。
 * 这条规则放在内核里，路由与 UI 共用同一份裁决，测试也能直接跑。
 */
export const MUTABLE_QUESTION_FIELDS = new Set(['markedWeak']);

/** 返回被拒绝的字段名；空数组表示这次修改合法。 */
export function rejectedQuestionEdits(changes: Record<string, unknown>): string[] {
  return Object.keys(changes).filter((key) => !MUTABLE_QUESTION_FIELDS.has(key));
}
