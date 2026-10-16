import { eq, desc, inArray } from 'drizzle-orm';
import { db } from '../index';
import {
  perspectiveJobs,
  perspectiveCandidates,
  perspectiveEvaluations,
  interviewQuestions,
} from '../schema';
import { rowToQuestion, questionToRow } from '@/lib/interview-core/legacy-questions';
import type { CandidateStatRow } from '@/lib/recruit/job-stats';
import { countAnswered } from '@/lib/recruit/answers';
import { normalizeQuestions } from '@/lib/recruit/questions';
// 岗位和候选人 id 都进 URL，短 id 才念得出来；存量 UUID 继续可用
import { shortId } from '@/lib/recruit/short-id';
import type {
  CandidateStatus,
  CandidateSummary,
  DimensionConfig,
  DimensionScore,
  InterviewQuestion,
  QuestionEvaluation,
  Recommendation,
} from '@/types/recruit';

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

  async findCandidate(candidateId: string): Promise<typeof perspectiveCandidates.$inferSelect | null> {
    const rows = await db
      .select()
      .from(perspectiveCandidates)
      .where(eq(perspectiveCandidates.id, candidateId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const questions = await this.findQuestionsByCandidateId(candidateId);
    return { ...row, questions: questions.length > 0 ? questions : null } as any;
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

  async findCandidatesByJobId(jobId: string): Promise<(typeof perspectiveCandidates.$inferSelect)[]> {
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
    ) as any;
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
    } as any);
    return this.findEvaluation(data.candidateId);
  },
};
