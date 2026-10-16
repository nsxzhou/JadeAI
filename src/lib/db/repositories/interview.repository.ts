import { eq, desc, and } from 'drizzle-orm';
import { db } from '../index';
import { interviewSessions, interviewRounds, interviewMessages, interviewReports } from '../schema';
import type {
  InterviewerConfig,
  InterviewSessionStatus,
  InterviewRoundStatus,
  InterviewMessageRole,
  RoundSummary,
  DimensionScore,
  RoundEvaluation,
  ImprovementItem,
  InterviewMessageMetadata,
} from '@/types/interview';

export const interviewRepository = {
  // ── Sessions ────────────────────────────────────────────────────────────────

  async createSession(data: {
    userId: string;
    resumeId?: string | null;
    jobDescription: string;
    jobTitle: string;
    selectedInterviewers: InterviewerConfig[];
  }) {
    const id = crypto.randomUUID();
    await db.insert(interviewSessions).values({
      id,
      userId: data.userId,
      resumeId: data.resumeId ?? null,
      jobDescription: data.jobDescription,
      jobTitle: data.jobTitle,
      selectedInterviewers: data.selectedInterviewers as any,
    } as any);
    return this.findSession(id);
  },

  async findSession(sessionId: string) {
    const rows = await db.select().from(interviewSessions).where(eq(interviewSessions.id, sessionId)).limit(1);
    return rows[0] ?? null;
  },

  async findSessionsByUserId(userId: string) {
    return db.select().from(interviewSessions).where(eq(interviewSessions.userId, userId)).orderBy(desc(interviewSessions.createdAt));
  },

  /**
   * 列表用：场次 + 报告摘要（总分与维度分）。
   *
   * 列表卡片要显示上次总分，但报告是另一个表；没有摘要时前端只能显示空白，
   * 所以这里是 dashboard 与 lobby 唯一的列表查询入口。
   */
  async findSessionSummariesByUserId(userId: string) {
    const rows = await db
      .select({ session: interviewSessions, report: interviewReports })
      .from(interviewSessions)
      .leftJoin(interviewReports, eq(interviewReports.sessionId, interviewSessions.id))
      .where(eq(interviewSessions.userId, userId))
      .orderBy(desc(interviewSessions.createdAt));

    return rows.map(({ session, report }: {
      session: typeof interviewSessions.$inferSelect;
      report: typeof interviewReports.$inferSelect | null;
    }) => ({
      ...session,
      reportSummary: report
        ? { overallScore: report.overallScore, dimensionScores: report.dimensionScores }
        : null,
    }));
  },

  async updateSessionStatus(sessionId: string, status: InterviewSessionStatus) {
    await db.update(interviewSessions).set({ status, updatedAt: new Date() }).where(eq(interviewSessions.id, sessionId));
  },

  async updateSessionRound(sessionId: string, currentRound: number) {
    await db.update(interviewSessions).set({ currentRound, updatedAt: new Date() }).where(eq(interviewSessions.id, sessionId));
  },

  async deleteSession(sessionId: string) {
    await db.delete(interviewSessions).where(eq(interviewSessions.id, sessionId));
  },

  // ── Rounds ───────────────────────────────────────────────────────────────────

  async createRound(data: {
    sessionId: string;
    interviewerType: string;
    interviewerConfig: InterviewerConfig;
    sortOrder: number;
    maxQuestions?: number;
  }) {
    const id = crypto.randomUUID();
    await db.insert(interviewRounds).values({
      id,
      sessionId: data.sessionId,
      interviewerType: data.interviewerType,
      interviewerConfig: data.interviewerConfig as any,
      sortOrder: data.sortOrder,
      maxQuestions: data.maxQuestions ?? 10,
    } as any);
    return this.findRound(id);
  },

  async findRound(roundId: string) {
    const rows = await db.select().from(interviewRounds).where(eq(interviewRounds.id, roundId)).limit(1);
    return rows[0] ?? null;
  },

  async findRoundsBySessionId(sessionId: string) {
    return db.select().from(interviewRounds).where(eq(interviewRounds.sessionId, sessionId)).orderBy(interviewRounds.sortOrder);
  },

  async updateRoundStatus(roundId: string, status: InterviewRoundStatus) {
    await db.update(interviewRounds).set({ status, updatedAt: new Date() }).where(eq(interviewRounds.id, roundId));
  },

  /** 递增并返回新值，调用方据此判断是否到达本轮题数上限。 */
  async incrementQuestionCount(roundId: string): Promise<number> {
    const rows = await db.select({ questionCount: interviewRounds.questionCount }).from(interviewRounds).where(eq(interviewRounds.id, roundId)).limit(1);
    const next = (rows[0]?.questionCount ?? 0) + 1;
    await db.update(interviewRounds).set({ questionCount: next, updatedAt: new Date() }).where(eq(interviewRounds.id, roundId));
    return next;
  },

  async setRoundSummary(roundId: string, summary: RoundSummary) {
    await db.update(interviewRounds).set({ summary: summary as any, updatedAt: new Date() }).where(eq(interviewRounds.id, roundId));
  },

  // ── Messages ─────────────────────────────────────────────────────────────────

  async addMessage(data: {
    /** 允许调用方指定 id，使流式响应的消息 id 与落库 id 一致。 */
    id?: string;
    roundId: string;
    role: InterviewMessageRole;
    content: string;
    metadata?: InterviewMessageMetadata;
  }) {
    const id = data.id ?? crypto.randomUUID();
    await db.insert(interviewMessages).values({
      id,
      roundId: data.roundId,
      role: data.role,
      content: data.content,
      metadata: (data.metadata ?? {}) as any,
    } as any);
    const rows = await db.select().from(interviewMessages).where(eq(interviewMessages.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async findMessagesByRoundId(roundId: string) {
    return db.select().from(interviewMessages).where(eq(interviewMessages.roundId, roundId)).orderBy(interviewMessages.createdAt);
  },

  async findAllMessagesBySessionId(sessionId: string) {
    const rounds = await db.select().from(interviewRounds).where(eq(interviewRounds.sessionId, sessionId)).orderBy(interviewRounds.sortOrder);
    if (rounds.length === 0) return [];
    const result = await Promise.all(
      rounds.map(async (round: typeof rounds[number]) => {
        const messages = await this.findMessagesByRoundId(round.id);
        return { round, messages };
      })
    );
    return result;
  },

  async updateMessageMetadata(messageId: string, metadata: InterviewMessageMetadata) {
    await db.update(interviewMessages).set({ metadata: metadata as any }).where(eq(interviewMessages.id, messageId));
  },

  /**
   * 合并控制标记（marked / hinted / skipped）进已有 metadata，而不是整体覆盖。
   * 三种标记会落在同一条消息上，覆盖会丢掉前一次的标记。
   */
  async mergeMessageMetadata(messageId: string, patch: InterviewMessageMetadata) {
    const rows = await db.select().from(interviewMessages).where(eq(interviewMessages.id, messageId)).limit(1);
    const existing = (rows[0]?.metadata ?? {}) as InterviewMessageMetadata;
    const merged = { ...existing, ...patch };
    await db.update(interviewMessages).set({ metadata: merged as any }).where(eq(interviewMessages.id, messageId));
    return merged;
  },

  // ── Reports ──────────────────────────────────────────────────────────────────

  async createReport(data: {
    sessionId: string;
    overallScore: number;
    dimensionScores: DimensionScore[];
    roundEvaluations: RoundEvaluation[];
    overallFeedback: string;
    improvementPlan: ImprovementItem[];
  }) {
    const id = crypto.randomUUID();
    await db.insert(interviewReports).values({
      id,
      sessionId: data.sessionId,
      overallScore: data.overallScore,
      dimensionScores: data.dimensionScores as any,
      roundEvaluations: data.roundEvaluations as any,
      overallFeedback: data.overallFeedback,
      improvementPlan: data.improvementPlan as any,
    } as any);
    return this.findReportBySessionId(data.sessionId);
  },

  async findReportBySessionId(sessionId: string) {
    const rows = await db.select().from(interviewReports).where(eq(interviewReports.sessionId, sessionId)).limit(1);
    return rows[0] ?? null;
  },

  async findReportsByUserId(userId: string) {
    const sessions = await db
      .select()
      .from(interviewSessions)
      .where(and(eq(interviewSessions.userId, userId), eq(interviewSessions.status, 'completed')));
    if (sessions.length === 0) return [];
    const results = await Promise.all(
      sessions.map(async (session: typeof sessions[number]) => {
        const report = await this.findReportBySessionId(session.id);
        if (!report) return null;
        return { report, session };
      })
    );
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
};
