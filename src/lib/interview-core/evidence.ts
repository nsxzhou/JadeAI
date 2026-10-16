/**
 * 蓝图 evidence 的归一化与绑定。
 *
 * 模型经常会「改写」evidence（把「负责订单系统的稳定性」写成「订单系统稳定性」），
 * 直接精确匹配会误杀合法蓝图，放松成分相似又会放过编造。裁决：归一化后精确匹配，
 * 匹配不上时先尝试把改写过的 evidence 重新绑定回来源列表里的原文。
 */
import type { InterviewBlueprint, InterviewQuestionSource, QuestionSlot } from './types';

/** Unicode 规范化 + 去大小写 + 去标点与空白。 */
export function normalizeEvidence(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

/** 归一化后的字符重合度；完全相等返回 Infinity，包含关系次之。 */
export function evidenceSimilarity(left: string, right: string): number {
  const a = normalizeEvidence(left);
  const b = normalizeEvidence(right);
  if (a === b) return Number.POSITIVE_INFINITY;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) * 2;
  const chars = new Set(a);
  return [...new Set(b)].reduce((score, char) => score + (chars.has(char) ? 1 : 0), 0);
}

/** 将模型可能改写过的 evidence 重新绑定到对应来源列表中的原文。 */
export function canonicalizeBlueprintEvidence(input: InterviewBlueprint): InterviewBlueprint {
  const entries = {
    resume: input.resumeFacts,
    jd: input.jdRequirements,
    gap: input.gaps,
  } satisfies Record<InterviewQuestionSource, string[]>;

  return {
    ...input,
    slots: input.slots.map((slot) => {
      const candidates = entries[slot.source];
      if (candidates.length === 0) return { ...slot };
      const evidence = [...candidates].sort(
        (left, right) => evidenceSimilarity(slot.evidence, right) - evidenceSimilarity(slot.evidence, left),
      )[0];
      return { ...slot, evidence };
    }),
  };
}

/** 来源列表名，用于报错文案与 prompt。 */
export function sourceListName(source: QuestionSlot['source']): 'resumeFacts' | 'jdRequirements' | 'gaps' {
  return source === 'resume' ? 'resumeFacts' : source === 'jd' ? 'jdRequirements' : 'gaps';
}
