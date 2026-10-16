/**
 * 旧 JSON 题目 → `interview_questions` 行的一次性回填。
 *
 * 在 `migrate()` 之后由两个 adapter 的 `initialize()` 调用。幂等：
 * - 只处理 `questions` 非空的候选人；
 * - 该候选人已经有序在 `interview_questions` 里就不再插（避免重复跑出双份）；
 * - 处理完把 `questions` 置 NULL，下次直接跳过。
 *
 * 题目落表之后，仓库层只读写 `interview_questions`，JSON 列不再被业务读取。
 */
import { eq, isNotNull } from 'drizzle-orm';
import { perspectiveCandidates, interviewQuestions } from './schema';
import { legacyQuestionsToRows } from '@/lib/interview-core/legacy-questions';
import { normalizeQuestions } from '@/lib/perspective/questions';

export async function backfillLegacyQuestions(db: any): Promise<number> {
  let candidates: Array<{ id: string; questions: unknown }>;
  try {
    candidates = await db
      .select({ id: perspectiveCandidates.id, questions: perspectiveCandidates.questions })
      .from(perspectiveCandidates)
      .where(isNotNull(perspectiveCandidates.questions));
  } catch (error) {
    // `questions` 列被 DROP 之后（阶段 5）这里会查询失败，那时回填已无意义。
    console.warn('[DB] legacy question backfill skipped:', error);
    return 0;
  }

  let migrated = 0;
  for (const candidate of candidates) {
    const questions = normalizeQuestions(candidate.questions);

    if (questions && questions.length > 0) {
      const existing = await db
        .select({ id: interviewQuestions.id })
        .from(interviewQuestions)
        .where(eq(interviewQuestions.perspectiveCandidateId, candidate.id))
        .limit(1);

      if (existing.length === 0) {
        await db
          .insert(interviewQuestions)
          .values(legacyQuestionsToRows(questions, candidate.id) as any);
      }
    }

    await db
      .update(perspectiveCandidates)
      .set({ questions: null } as any)
      .where(eq(perspectiveCandidates.id, candidate.id));
    migrated += 1;
  }

  if (migrated > 0) {
    console.log(`[DB] migrated ${migrated} legacy question JSON column(s) to interview_questions`);
  }
  return migrated;
}
