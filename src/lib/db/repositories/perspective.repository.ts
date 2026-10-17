import { eq, desc, inArray } from 'drizzle-orm';
import { db } from '../index';
import {
  perspectiveJobs,
  perspectiveCandidates,
  perspectiveEvaluations,
  interviewQuestions,
} from '../schema';
import { rowToQuestion, questionToRow } from '@/lib/interview-core/legacy-questions';
import type { CandidateStatRow } from '@/lib/perspective/job-stats';
import { countAnswered } from '@/lib/perspective/answers';
// 岗位和候选人 id 都进 URL，短 id 才念得出来；存量 UUID 继续可用
import { shortId } from '@/lib/perspective/short-id';
import type {
  CandidateStatus,
  CandidateSummary,
  DimensionConfig,
  DimensionScore,
  InterviewQuestion,
  QuestionEvaluation,
  Recommendation,
} from '@/types/perspective';

/**
 * 候选人行 + 从 interview_questions 读回的题目。
 *
 * 题目的权威存储是 `interview_questions`，`perspective_candidates.questions`
 * JSON 列只剩历史包袱（回填后为 NULL），所以读取路径统一补上这一字段。
 */
export type PerspectiveCandidateRow = typeof perspectiveCandidates.$inferSelect & {
  questions: InterviewQuestion[] | null;
};

/** JSON 列在 sqlite 是对象/数组、在 pg 是 text；两种形态都读成数组。 */
function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const perspectiveRepository = {
  // ── Jobs ────────────────────────────────────────────────────────────────────

  async createJob(data: {
    userId: string;
    title: string;
    jobDescription: string;
    dimensions: DimensionConfig[];
    questionCount: number;
    roleFamilyKey?: string | null;
    primaryStack?: string | null;
    questionCounts?: Record<string, number> | null;
  }) {
    const id = shortId();
    await db.insert(perspectiveJobs).values({
      id,
      userId: data.userId,
      title: data.title,
      jobDescription: data.jobDescription,
      dimensions: data.dimensions as any,
      questionCount: data.questionCount,
      roleFamilyKey: data.roleFamilyKey ?? null,
      primaryStack: data.primaryStack ?? null,
      questionCounts: (data.questionCounts ?? null) as any,
    } as any);
    return this.findJob(id);
  },

  async findJob(jobId: string): Promise<typeof perspectiveJobs.$inferSelect | null> {
    const rows = await db.select().from(perspectiveJobs).where(eq(perspectiveJobs.id, jobId)).limit(1);
    return rows[0] ?? null;
  },

  async findJobsByUserId(userId: string): Promise<(typeof perspectiveJobs.$inferSelect)[]> {
    return db
      .select()
      .from(perspectiveJobs)
      .where(eq(perspectiveJobs.userId, userId))
      .orderBy(desc(perspectiveJobs.createdAt));
  },

  /**
   * 该用户名下所有候选人的「岗位 + 评价结论」明细，供岗位列表卡片统计用。
   *
   * 一次查询取全量再在 JS 里聚合：单个用户的候选人总量很小，
   * 而聚合 SQL 在 SQLite 与 PG 之间要额外小心，不值得引方言分支。
   */
  async findCandidateStatsByUserId(userId: string): Promise<CandidateStatRow[]> {
    const rows = await db
      .select({
        jobId: perspectiveCandidates.jobId,
        status: perspectiveCandidates.status,
        recommendation: perspectiveEvaluations.recommendation,
      })
      .from(perspectiveCandidates)
      .innerJoin(perspectiveJobs, eq(perspectiveJobs.id, perspectiveCandidates.jobId))
      .leftJoin(perspectiveEvaluations, eq(perspectiveEvaluations.candidateId, perspectiveCandidates.id))
      .where(eq(perspectiveJobs.userId, userId));

    return rows.map((r: any) => ({
      jobId: r.jobId as string,
      status: r.status as CandidateStatus,
      recommendation: (r.recommendation ?? null) as Recommendation | null,
    }));
  },

  async updateJob(
    jobId: string,
    data: Partial<{
      title: string;
      jobDescription: string;
      dimensions: DimensionConfig[];
      questionCount: number;
      roleFamilyKey: string | null;
      primaryStack: string | null;
      questionCounts: Record<string, number> | null;
    }>,
  ) {
    await db
      .update(perspectiveJobs)
      .set({ ...data, updatedAt: new Date() } as any)
      .where(eq(perspectiveJobs.id, jobId));
    return this.findJob(jobId);
  },

  async deleteJob(jobId: string) {
    await db.delete(perspectiveJobs).where(eq(perspectiveJobs.id, jobId));
  },

  // ── Candidates ──────────────────────────────────────────────────────────────

  async createCandidate(data: { jobId: string; name: string }) {
    const id = shortId();
    await db.insert(perspectiveCandidates).values({
      id,
      jobId: data.jobId,
      name: data.name,
    } as any);
    return this.findCandidate(id);
  },

  async findCandidate(candidateId: string): Promise<PerspectiveCandidateRow | null> {
    const rows = await db
      .select()
      .from(perspectiveCandidates)
      .where(eq(perspectiveCandidates.id, candidateId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const questions = await this.findQuestionsByCandidateId(candidateId);
    return { ...row, questions: questions.length > 0 ? questions : null } as PerspectiveCandidateRow;
  },

  /** 题目已升格为实体，读写都走 interview_questions。 */
  async findQuestionsByCandidateId(candidateId: string): Promise<InterviewQuestion[]> {
    const rows = await db
      .select()
      .from(interviewQuestions)
      .where(eq(interviewQuestions.perspectiveCandidateId, candidateId))
      .orderBy(interviewQuestions.sortOrder);
    return rows.map((row: Record<string, unknown>) => rowToQuestion(row));
  },

  /** 整份替换某候选人的题目。先删后插，保留前端已经给出的题目 id。 */
  async replaceQuestions(candidateId: string, questions: InterviewQuestion[]) {
    await db.delete(interviewQuestions).where(eq(interviewQuestions.perspectiveCandidateId, candidateId));
    if (questions.length === 0) return;
    const rows = questions.map((question, index) =>
      questionToRow(question, { perspectiveCandidateId: candidateId }, index),
    );
    await db.insert(interviewQuestions).values(rows as any);
  },

  async findCandidatesByJobId(jobId: string): Promise<PerspectiveCandidateRow[]> {
    const rows = await db
      .select()
      .from(perspectiveCandidates)
      .where(eq(perspectiveCandidates.jobId, jobId))
      .orderBy(desc(perspectiveCandidates.createdAt));
    return Promise.all(
      rows.map(async (row: { id: string }) => {
        const questions = await this.findQuestionsByCandidateId(row.id);
        return { ...row, questions: questions.length > 0 ? questions : null };
      }),
    ) as Promise<PerspectiveCandidateRow[]>;
  },

  /**
   * 岗位详情页的候选人列表：只取列表要显示的列，评价的大 JSON 不查出来。
   * 题目已升格为实体，计数改为一次查询 interview_questions 再在 JS 里分组，
   * 避免列表逐行查询的 N+1。
   */
  async findCandidateSummaries(jobId: string): Promise<CandidateSummary[]> {
    const rows = await db
      .select({
        id: perspectiveCandidates.id,
        name: perspectiveCandidates.name,
        status: perspectiveCandidates.status,
        createdAt: perspectiveCandidates.createdAt,
        // 列表那一行的主按钮要靠这两个字段判断走到哪一步了
        resumeText: perspectiveCandidates.resumeText,
        overallScore: perspectiveEvaluations.overallScore,
        recommendation: perspectiveEvaluations.recommendation,
        dimensionScores: perspectiveEvaluations.dimensionScores,
      })
      .from(perspectiveCandidates)
      .leftJoin(perspectiveEvaluations, eq(perspectiveEvaluations.candidateId, perspectiveCandidates.id))
      .where(eq(perspectiveCandidates.jobId, jobId))
      .orderBy(desc(perspectiveCandidates.createdAt));

    const ids = rows.map((row: any) => row.id as string);
    const questionRows = ids.length > 0
      ? await db
        .select({
          candidateId: interviewQuestions.perspectiveCandidateId,
          answer: interviewQuestions.answer,
          status: interviewQuestions.status,
        })
        .from(interviewQuestions)
        .where(inArray(interviewQuestions.perspectiveCandidateId, ids))
      : [];

    const byCandidate = new Map<string, InterviewQuestion[]>();
    for (const row of questionRows as Array<{ candidateId: string; answer: string; status: string }>) {
      const list = byCandidate.get(row.candidateId) ?? [];
      list.push({ answer: row.answer, status: row.status } as InterviewQuestion);
      byCandidate.set(row.candidateId, list);
    }

    return rows.map((r: any) => {
      const questions = byCandidate.get(r.id as string) ?? [];
      return {
        id: r.id,
        name: r.name,
        status: r.status as CandidateStatus,
        createdAt: r.createdAt,
        // 只回传布尔和计数，简历正文和题目大 JSON 不进列表响应
        hasResume: Boolean((r.resumeText ?? '').trim()),
        questionCount: questions.length,
        answeredCount: countAnswered(questions),
        overallScore: r.overallScore ?? null,
        recommendation: (r.recommendation ?? null) as Recommendation | null,
        // 维度分很小（每维一条），带进列表就能免掉对比表的逐人回查
        dimensionScores: (r.dimensionScores ?? []) as DimensionScore[],
      };
    });
  },

  async updateCandidate(
    candidateId: string,
    data: Partial<{
      name: string;
      status: CandidateStatus;
      resumeText: string;
      resumeData: unknown;
      questions: InterviewQuestion[] | null;
      transcript: string;
    }>,
  ) {
    const { questions, ...rest } = data;
    if (Object.keys(rest).length > 0) {
      await db
        .update(perspectiveCandidates)
        .set({ ...rest, updatedAt: new Date() } as any)
        .where(eq(perspectiveCandidates.id, candidateId));
    }
    if (questions !== undefined) {
      await this.replaceQuestions(candidateId, questions ?? []);
    }
    return this.findCandidate(candidateId);
  },

  async deleteCandidate(candidateId: string) {
    await db.delete(perspectiveCandidates).where(eq(perspectiveCandidates.id, candidateId));
  },

  /**
   * 能力画像的数据源：该用户名下所有已完成的面试官视角评价。
   *
   * 只取画图要用的三列，评价的大 JSON 不进这里；坐标能不能识别由 `buildProfile`
   * 判定（老评价的自定义 key 会被排除）。
   */
  async findEvaluationProfilesByUserId(userId: string): Promise<Array<{
    candidateId: string;
    createdAt: Date | string;
    roleFamilyKey: string | null;
    dimensionScores: DimensionScore[];
  }>> {
    const rows = await db
      .select({
        candidateId: perspectiveCandidates.id,
        createdAt: perspectiveEvaluations.createdAt,
        roleFamilyKey: perspectiveJobs.roleFamilyKey,
        dimensionScores: perspectiveEvaluations.dimensionScores,
      })
      .from(perspectiveEvaluations)
      .innerJoin(perspectiveCandidates, eq(perspectiveCandidates.id, perspectiveEvaluations.candidateId))
      .innerJoin(perspectiveJobs, eq(perspectiveJobs.id, perspectiveCandidates.jobId))
      .where(eq(perspectiveJobs.userId, userId));

    return rows.map((row: any) => ({
      candidateId: row.candidateId as string,
      createdAt: row.createdAt as Date | string,
      roleFamilyKey: (row.roleFamilyKey ?? null) as string | null,
      dimensionScores: parseJsonArray<DimensionScore>(row.dimensionScores),
    }));
  },

  // ── Evaluations ─────────────────────────────────────────────────────────────

  async findEvaluation(candidateId: string): Promise<typeof perspectiveEvaluations.$inferSelect | null> {
    const rows = await db
      .select()
      .from(perspectiveEvaluations)
      .where(eq(perspectiveEvaluations.candidateId, candidateId))
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * 一个候选人一份评价。重新生成时先删后插——candidate_id 上有 unique 约束，
   * 直接 insert 会撞约束。
   */
  async upsertEvaluation(data: {
    candidateId: string;
    overallScore: number;
    dimensionScores: DimensionScore[];
    questionEvaluations: QuestionEvaluation[];
    recommendation: Recommendation;
    recommendationReason: string;
    strengths: string[];
    concerns: string[];
    overallComment: string;
    /** partial = 逐题段还在跑；complete = 汇总段已落定 */
    status?: 'partial' | 'complete';
  }) {
    await db
      .delete(perspectiveEvaluations)
      .where(eq(perspectiveEvaluations.candidateId, data.candidateId));
    const id = shortId();
    await db.insert(perspectiveEvaluations).values({
      id,
      candidateId: data.candidateId,
      overallScore: data.overallScore,
      dimensionScores: data.dimensionScores as any,
      questionEvaluations: data.questionEvaluations as any,
      recommendation: data.recommendation,
      recommendationReason: data.recommendationReason,
      strengths: data.strengths as any,
      concerns: data.concerns as any,
      overallComment: data.overallComment,
      status: data.status ?? 'complete',
    } as any);
    return this.findEvaluation(data.candidateId);
  },

  /**
   * 存一块逐题评估。
   *
   * 分块评估的中间态必须落库，否则第二块失败时第一块的结论就丢了，
   * 用户只能从头再花一次模型调用。汇总字段先留空（status = partial）。
   */
  async saveEvaluationChunk(candidateId: string, evaluations: QuestionEvaluation[]) {
    const existing = await this.findEvaluation(candidateId);
    const merged = new Map<string, QuestionEvaluation>(
      ((existing?.questionEvaluations ?? []) as QuestionEvaluation[])
        .filter((item) => Boolean(item.questionId))
        .map((item) => [item.questionId as string, item] as const),
    );
    for (const evaluation of evaluations) {
      if (evaluation.questionId) merged.set(evaluation.questionId, evaluation);
    }

    return this.upsertEvaluation({
      candidateId,
      overallScore: existing?.overallScore ?? 0,
      dimensionScores: ((existing?.dimensionScores ?? []) as DimensionScore[]),
      questionEvaluations: [...merged.values()],
      recommendation: (existing?.recommendation ?? 'hold') as Recommendation,
      recommendationReason: existing?.recommendationReason ?? '',
      strengths: ((existing?.strengths ?? []) as string[]),
      concerns: ((existing?.concerns ?? []) as string[]),
      overallComment: existing?.overallComment ?? '',
      status: 'partial',
    });
  },

  /** 「重新生成」：清掉旧评价与旧单题分，从头跑一遍两段式。 */
  async resetEvaluation(candidateId: string) {
    await db
      .delete(perspectiveEvaluations)
      .where(eq(perspectiveEvaluations.candidateId, candidateId));
  },

  /** 单题分落库。面试官视角的题目只在这张表里，所以按 id 更新即可。 */
  async updateQuestionScore(questionId: string, data: { tier: string | null; score: number | null }) {
    await db
      .update(interviewQuestions)
      .set({ tier: data.tier, score: data.score } as any)
      .where(eq(interviewQuestions.id, questionId));
  },
};
