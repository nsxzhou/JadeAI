/**
 * 结论收尾：把模型给的「强推 / 可过 / 待定 / 不过」收成一句站得住的话。
 *
 * 两件事：
 * 1. 去掉「候选人 / 人名」这类招聘视角的措辞——翻转后「候选人」就是求职者自己；
 * 2. 覆盖度闸门：证据不足时不给明确结论，改成「待定 + 补面建议」。录用/淘汰是
 *    招聘方的话；这里说的是「按这份简历会被怎么判」。
 */
import type { Recommendation } from '@/types/perspective';

export interface PerspectiveSummary {
  strengths: string[];
  concerns: string[];
  overallComment: string;
  recommendation: Recommendation;
  recommendationReason: string;
}

export interface EvaluationCoverage {
  ownerName: string;
  substantiveQuestionCount: number;
  assessedDimensionCount: number;
  configuredDimensionCount: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripOwnerReferences(value: string, ownerName: string): string {
  const name = ownerName.trim();
  const patterns = [
    ...(name ? [`候选人\\s*${escapeRegExp(name)}`, escapeRegExp(name)] : []),
    '该候选人',
    '候选人',
  ];

  return value
    .replace(new RegExp(patterns.join('|'), 'g'), '')
    .replace(/(^|[。！？；]\s*)[，、：；]+/g, '$1')
    .replace(/\s+([，。！？；：])/g, '$1')
    .trim();
}

export function finalizePerspectiveSummary(
  summary: PerspectiveSummary,
  coverage: EvaluationCoverage,
): PerspectiveSummary {
  const clean = (value: string) => stripOwnerReferences(value, coverage.ownerName);
  const insufficientCoverage =
    coverage.substantiveQuestionCount < 5
    || coverage.assessedDimensionCount * 2 < coverage.configuredDimensionCount;

  const result: PerspectiveSummary = {
    strengths: summary.strengths.map(clean),
    concerns: summary.concerns.map(clean),
    overallComment: clean(summary.overallComment),
    recommendation: summary.recommendation,
    recommendationReason: clean(summary.recommendationReason),
  };

  if (!insufficientCoverage) return result;

  const coverageSummary = `本轮仅完成 ${coverage.substantiveQuestionCount} 道有效题，覆盖 ${coverage.assessedDimensionCount}/${coverage.configuredDimensionCount} 个考察维度`;
  return {
    ...result,
    recommendation: 'hold',
    recommendationReason: `${coverageSummary}，证据不足以支撑明确判决。建议围绕 JD 必须项和未覆盖维度补几道题再推演。`,
    overallComment: `${result.overallComment}\n\n证据充分性：本轮证据不足（${coverageSummary}）。建议补面后再形成最终判断。`,
  };
}

/**
 * 分块评估要评哪些题。
 *
 * 两条规则都在防「越评越乱」：
 * - 有逐题记录的就在这些题里评；只有整段速记时才把全部题都放进来；
 * - 已经评过（有单题分）或已经有评估草稿的题不再进块——没有回答的题可能永远拿不到
 *   分数，只按分数判断会让它被反复重新评估、循环不止。
 */
export function planEvaluationPool<T extends {
  id?: string;
  score?: number | null;
  answer?: string | null;
}>(questions: T[], draftedIds: ReadonlySet<string>): { pool: T[]; pending: T[] } {
  const recorded = questions.filter((question) => Boolean(question.answer?.trim()));
  const pool = recorded.length > 0 ? recorded : questions;
  const pending = pool.filter(
    (question) =>
      typeof question.score !== 'number' && !draftedIds.has(question.id ?? ''),
  );
  return { pool, pending };
}
