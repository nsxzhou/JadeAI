import { beforeEach, describe, expect, it, vi } from 'vitest';

// 同 recruit.repository.test.ts：src/lib/db/index.ts 在 import 时就会打开真实
// 的 SQLite 文件，所以每个碰 repository 的测试都必须把它替换掉。
vi.mock('../index', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const schema = await import('../schema');

  const dir = mkdtempSync(join(tmpdir(), 'jade-interview-'));
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: 'drizzle/migrations' });

  return { db, dbReady: Promise.resolve(), adapter: null };
});

const { interviewRepository } = await import('./interview.repository');
const { db } = await import('../index');
const { users, interviewSessions, interviewRounds, interviewMessages, interviewReports } = await import('../schema');

const USER_ID = 'test-user-interview';

beforeEach(async () => {
  await db.delete(interviewReports);
  await db.delete(interviewMessages);
  await db.delete(interviewRounds);
  await db.delete(interviewSessions);
  await db.delete(users);
  await db.insert(users).values({ id: USER_ID, authType: 'local' });
});

async function createRound(maxQuestions = 3) {
  const session = await interviewRepository.createSession({
    userId: USER_ID,
    jobDescription: 'JD',
    jobTitle: '后端工程师',
    selectedInterviewers: [],
  });
  const round = await interviewRepository.createRound({
    sessionId: session!.id,
    interviewerType: 'technical',
    interviewerConfig: { type: 'technical' } as never,
    sortOrder: 0,
    maxQuestions,
  });
  return { session: session!, round: round! };
}

describe('interviewRepository — messages', () => {
  it('用调用方给的 id 落库，使流式响应与 DB 用同一个 id', async () => {
    const { round } = await createRound();
    const saved = await interviewRepository.addMessage({
      id: 'assistant-message-1',
      roundId: round.id,
      role: 'interviewer',
      content: '介绍一下你自己',
    });
    expect(saved!.id).toBe('assistant-message-1');
    expect(await interviewRepository.findMessagesByRoundId(round.id)).toHaveLength(1);
  });

  it('合并控制标记而不是整体覆盖', async () => {
    const { round } = await createRound();
    const saved = await interviewRepository.addMessage({
      id: 'm1',
      roundId: round.id,
      role: 'interviewer',
      content: '题目',
    });

    await interviewRepository.mergeMessageMetadata(saved!.id, { marked: true });
    const merged = await interviewRepository.mergeMessageMetadata(saved!.id, { hinted: true });

    expect(merged).toEqual({ marked: true, hinted: true });
    const messages = await interviewRepository.findMessagesByRoundId(round.id);
    expect(messages[0].metadata).toEqual({ marked: true, hinted: true });
  });
});

describe('interviewRepository — rounds', () => {
  it('递增题数并返回新值，供服务端判断是否到达上限', async () => {
    const { round } = await createRound(2);
    expect(await interviewRepository.incrementQuestionCount(round.id)).toBe(1);
    expect(await interviewRepository.incrementQuestionCount(round.id)).toBe(2);
  });
});

describe('interviewRepository — session list', () => {
  it('列表带出报告摘要，没有报告时为 null', async () => {
    const { session: withReport } = await createRound();
    const { session: withoutReport } = await createRound();

    await interviewRepository.createReport({
      sessionId: withReport.id,
      overallScore: 82,
      dimensionScores: [{ dimension: 'general_logic', score: 82, maxScore: 100 }],
      roundEvaluations: [],
      overallFeedback: '不错',
      improvementPlan: [],
    });

    const sessions = await interviewRepository.findSessionSummariesByUserId(USER_ID);
    const scored = sessions.find((s: { id: string }) => s.id === withReport.id)!;
    const unscored = sessions.find((s: { id: string }) => s.id === withoutReport.id)!;

    expect(scored.reportSummary?.overallScore).toBe(82);
    expect(scored.reportSummary?.dimensionScores).toHaveLength(1);
    expect(unscored.reportSummary).toBeNull();
  });
});
