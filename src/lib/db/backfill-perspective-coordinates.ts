/**
 * 旧面试官视角坐标 → 两层坐标的一次性回填。
 *
 * 在 `migrate()` 之后由两个 adapter 的 `initialize()` 调用。幂等：
 * - 岗位已经有 `role_family_key` 与 `question_counts` 就跳过；
 * - 题目维度只在命中旧 key 时才更新（映射表对 canon key 是恒等）。
 *
 * 纯映射逻辑在 `@/lib/interview-core/perspective-legacy`；这里只负责读写与幂等。
 */
import { eq, isNotNull } from 'drizzle-orm';
import { interviewQuestions, perspectiveJobs } from './schema';
import {
  legacyPerspectiveCoordinates,
  mapLegacyQuestionDimension,
} from '@/lib/interview-core/perspective-legacy';
import { parseQuestionCounts } from '@/lib/perspective/job-coordinates';

export interface PerspectiveBackfillResult {
  jobs: number;
  questions: number;
}

export async function backfillPerspectiveCoordinates(db: any): Promise<PerspectiveBackfillResult> {
  const result: PerspectiveBackfillResult = { jobs: 0, questions: 0 };

  // ── 岗位坐标 ────────────────────────────────────────────────────────────────
  const jobs = await db
    .select({
      id: perspectiveJobs.id,
      title: perspectiveJobs.title,
      jobDescription: perspectiveJobs.jobDescription,
      roleFamilyKey: perspectiveJobs.roleFamilyKey,
      questionCounts: perspectiveJobs.questionCounts,
      dimensions: perspectiveJobs.dimensions,
    })
    .from(perspectiveJobs);

  for (const job of jobs) {
    const alreadyBackfilled = Boolean(job.roleFamilyKey) && Boolean(parseQuestionCounts(job.questionCounts));
    if (alreadyBackfilled) continue;

    const coordinates = legacyPerspectiveCoordinates({
      title: job.title,
      jobDescription: job.jobDescription,
      dimensions: job.dimensions,
    });
    const questionCount = Object.values(coordinates.questionCounts)
      .reduce((sum, count) => sum + count, 0);

    await db
      .update(perspectiveJobs)
      .set({
        roleFamilyKey: coordinates.roleFamilyKey,
        primaryStack: coordinates.primaryStack,
        dimensions: coordinates.dimensions,
        questionCounts: coordinates.questionCounts,
        questionCount,
      })
      .where(eq(perspectiveJobs.id, job.id));

    result.jobs += 1;
  }

  // ── 存量题目的维度 key ──────────────────────────────────────────────────────
  const questions = await db
    .select({
      id: interviewQuestions.id,
      dimensionKey: interviewQuestions.dimensionKey,
    })
    .from(interviewQuestions)
    .where(isNotNull(interviewQuestions.perspectiveCandidateId));

  for (const question of questions) {
    const mapped = mapLegacyQuestionDimension(question.dimensionKey);
    if (mapped === question.dimensionKey) continue;

    await db
      .update(interviewQuestions)
      .set({ dimensionKey: mapped })
      .where(eq(interviewQuestions.id, question.id));
    result.questions += 1;
  }

  if (result.jobs > 0 || result.questions > 0) {
    console.log(
      `[DB] backfilled ${result.jobs} perspective job coordinate(s) and ${result.questions} question dimension(s)`,
    );
  }

  return result;
}
