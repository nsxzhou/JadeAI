import { eq, desc, and, inArray } from 'drizzle-orm';
import { db } from '../index';
import { interviewSessions, interviewRounds, interviewMessages, interviewReports, interviewQuestions } from '../schema';
import { questionToRow, type InterviewQuestionRow } from '@/lib/interview-core/legacy-questions';
import type {
  InterviewerConfig,
  InterviewSessionStatus,
  InterviewRoundStatus,
  InterviewMessageRole,
  RoundSummary,
  ImprovementItem,
  InterviewMessageMetadata,
} from '@/types/interview';
import type {
  DimensionScore as DomainDimensionScore,
  RoundEvaluation as DomainRoundEvaluation,
} from '@/lib/interview-core/types';

/** 跨场次查询的题目行：题目 + 它属于哪个场次。 */
export interface UserQuestionRow {
  question: Record<string, unknown>;
  sessionId: string;
  jobTitle: string;
  roleFamilyKey: string | null;
  createdAt: string;
}

export const interviewRepository = {
  // ── Sessions ────────────────────────────────────────────────────────────────

  async createSession(data: {
    userId: string;
    resumeId?: string | null;
    jobDescription: string;
    jobTitle: string;
    selectedInterviewers: InterviewerConfig[];
    roleFamilyKey?: string | null;
    primaryStack?: string | null;
    questionCountPreset?: string | null;
    stressLevel?: string;
    totalTimeLimitSec?: number | null;
    startedAt?: Date | null;
  }) {
    const id = crypto.randomUUID();
    await db.insert(interviewSessions).values({
      id,
      userId: data.userId,
      resumeId: data.resumeId ?? null,
      jobDescription: data.jobDescription,
      jobTitle: data.jobTitle,
      selectedInterviewers: data.selectedInterviewers as any,
      roleFamilyKey: data.roleFamilyKey ?? null,
      primaryStack: data.primaryStack ?? null,
      questionCountPreset: data.questionCountPreset ?? null,
      stressLevel: data.stressLevel ?? 'gentle',
      totalTimeLimitSec: data.totalTimeLimitSec ?? null,
      startedAt: data.startedAt ?? null,
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

  /** 轮次开始/结束时间，供转场与计时展示。 */
  async markRoundStarted(roundId: string) {
    await db
      .update(interviewRounds)
      .set({ startedAt: new Date(), updatedAt: new Date() })
      .where(eq(interviewRounds.id, roundId));
  },

  async markRoundFinished(roundId: string) {
    await db
      .update(interviewRounds)
      .set({ finishedAt: new Date(), status: 'completed', updatedAt: new Date() })
      .where(eq(interviewRounds.id, roundId));
  },

  /** 题数在生成之后才知道，轮次的 maxQuestions 生成完回写。 */
  async updateRoundMaxQuestions(roundId: string, maxQuestions: number) {
    await db.update(interviewRounds).set({ maxQuestions, updatedAt: new Date() }).where(eq(interviewRounds.id, roundId));
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
    /** 这条消息属于哪道题（含追问消息），报告追溯靠它 */
    questionId?: string | null;
  }) {
    const id = data.id ?? crypto.randomUUID();
    await db.insert(interviewMessages).values({
      id,
      roundId: data.roundId,
      role: data.role,
      content: data.content,
      metadata: (data.metadata ?? {}) as any,
      questionId: data.questionId ?? null,
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

  // ── Questions ───────────────────────────────────────────────────────────────

  /** 整场题目（候选人侧），按所属轮次与顺序返回。 */
  async findQuestionsBySessionId(sessionId: string) {
    const rounds = await this.findRoundsBySessionId(sessionId);
    if (rounds.length === 0) return [];
    const roundIds = rounds.map((round: { id: string }) => round.id);
    return db
      .select()
      .from(interviewQuestions)
      .where(inArray(interviewQuestions.roundId, roundIds))
      .orderBy(interviewQuestions.sortOrder);
  },

  async findQuestionsByRoundId(roundId: string) {
    return db
      .select()
      .from(interviewQuestions)
      .where(eq(interviewQuestions.roundId, roundId))
      .orderBy(interviewQuestions.sortOrder);
  },

  /** 整批落库。调用方保证「要么全落、要么不落」。 */
  async insertQuestions(rows: InterviewQuestionRow[]) {
    if (rows.length === 0) return;
    await db.insert(interviewQuestions).values(rows as any);
  },

  /**
   * 跨场次的题目：错题本与画像都从这里取。
   *
   * 一次取全量再在 JS 里按会话聚合：单用户的面试量很小，不值得为两种方言各写一套 SQL。
   */
  async findQuestionsByUserId(userId: string): Promise<UserQuestionRow[]> {
    const sessions = await db
      .select({ id: interviewSessions.id, jobTitle: interviewSessions.jobTitle, roleFamilyKey: interviewSessions.roleFamilyKey })
      .from(interviewSessions)
      .where(eq(interviewSessions.userId, userId));
    if (sessions.length === 0) return [];

    const sessionById = new Map<string, { id: string; jobTitle: string; roleFamilyKey: string | null }>(
      sessions.map((session: { id: string; jobTitle: string; roleFamilyKey: string | null }) => [session.id, session]),
    );
    const rounds = await db
      .select({ id: interviewRounds.id, sessionId: interviewRounds.sessionId })
      .from(interviewRounds)
      .where(inArray(interviewRounds.sessionId, sessions.map((session: { id: string }) => session.id)));
    if (rounds.length === 0) return [];

    const roundToSession = new Map<string, string>(
      rounds.map((round: { id: string; sessionId: string }) => [round.id, round.sessionId]),
    );
    const questions = await db
      .select()
      .from(interviewQuestions)
      .where(inArray(interviewQuestions.roundId, rounds.map((round: { id: string }) => round.id)));

    return questions
      .map((row: Record<string, unknown>): UserQuestionRow | null => {
        const sessionId = roundToSession.get(String(row.roundId));
        if (!sessionId) return null;
        const session = sessionById.get(sessionId);
        return {
          question: row,
          sessionId,
          jobTitle: String(session?.jobTitle ?? ''),
          roleFamilyKey: session?.roleFamilyKey ?? null,
          createdAt: new Date((row.updatedAt as Date | string | undefined) ?? Date.now()).toISOString(),
        };
      })
      .filter((value: UserQuestionRow | null): value is UserQuestionRow => value !== null);
  },

  /** 更新单题（答录、评分、标记）。只允许改白名单字段。 */
  async updateQuestion(
    questionId: string,
    data: Partial<{
      answer: string;
      status: string;
      timeSpentSec: number | null;
      timedOut: boolean;
      tier: string | null;
      score: number | null;
      markedWeak: boolean;
    }>,
  ) {
    await db
      .update(interviewQuestions)
      .set({
        ...data,
        // 两个布尔列在两种方言下分别是 boolean / integer，统一转成 0/1 由 drizzle 处理
        ...(data.timedOut !== undefined ? { timedOut: data.timedOut ? 1 : 0 } : {}),
        ...(data.markedWeak !== undefined ? { markedWeak: data.markedWeak ? 1 : 0 } : {}),
        updatedAt: new Date(),
      } as any)
      .where(eq(interviewQuestions.id, questionId));
  },

  async setSessionCurrentQuestion(sessionId: string, questionId: string | null) {
    await db
      .update(interviewSessions)
      .set({ currentQuestionId: questionId, updatedAt: new Date() })
      .where(eq(interviewSessions.id, sessionId));
  },

  async setSessionStartedAt(sessionId: string, startedAt: Date) {
    await db
      .update(interviewSessions)
      .set({ startedAt, updatedAt: new Date() })
      .where(eq(interviewSessions.id, sessionId));
  },

  // ── Reports ──────────────────────────────────────────────────────────────────

  async createReport(data: {
    sessionId: string;
    overallScore: number;
    dimensionScores: DomainDimensionScore[];
    roundEvaluations: DomainRoundEvaluation[];
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
