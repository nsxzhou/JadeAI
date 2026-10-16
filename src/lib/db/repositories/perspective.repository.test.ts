import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// 同 user.repository.local-user.test.ts：src/lib/db/index.ts 在 import 时就会打开
// 真实的 SQLite 文件，所以每个碰 repository 的测试都必须把它替换掉。
vi.mock('../index', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const schema = await import('../schema');

  const dir = mkdtempSync(join(tmpdir(), 'jade-recruit-'));
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: 'drizzle/migrations' });

  return { db, dbReady: Promise.resolve(), adapter: null };
});

const { perspectiveRepository } = await import('./perspective.repository');
const { db } = await import('../index');
const { backfillLegacyQuestions } = await import('../backfill-questions');
const { users, perspectiveJobs, perspectiveCandidates, perspectiveEvaluations, interviewQuestions } = await import('../schema');

const USER_ID = 'test-user-recruit';

beforeEach(async () => {
  await db.delete(perspectiveEvaluations);
  await db.delete(perspectiveCandidates);
  await db.delete(perspectiveJobs);
  await db.delete(users);
  await db.insert(users).values({ id: USER_ID, authType: 'local' });
});

const DIMENSIONS = [
  { key: 'professional', label: '专业技能', weight: 3, layer: 'family' as const, custom: false },
  { key: 'logic', label: '逻辑思维', weight: 2, layer: 'family' as const, custom: false },
];

async function createJob() {
  const job = await perspectiveRepository.createJob({
    userId: USER_ID,
    title: '高级前端工程师',
    jobDescription: '负责核心页面开发',
    dimensions: DIMENSIONS,
    questionCount: 10,
  });
  if (!job) throw new Error('createJob returned null');
  return job;
}

describe('perspectiveRepository — jobs', () => {
  it('创建岗位并把 dimensions 原样存回', async () => {
    const job = await createJob();
    expect(job.title).toBe('高级前端工程师');
    expect(job.dimensions).toEqual(DIMENSIONS);
    expect(job.questionCount).toBe(10);
  });

  it('按用户列出岗位，最新的在前', async () => {
    const first = await createJob();
    const second = await perspectiveRepository.createJob({
      userId: USER_ID,
      title: '后端工程师',
      jobDescription: 'JD',
      dimensions: DIMENSIONS,
      questionCount: 8,
    });
    const jobs = await perspectiveRepository.findJobsByUserId(USER_ID);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.id)).toContain(first.id);
    expect(jobs.map((j) => j.id)).toContain(second!.id);
  });

  it('更新岗位的维度与题目数', async () => {
    const job = await createJob();
    const next = [...DIMENSIONS, { key: 'stress', label: '抗压能力', weight: 1, layer: 'family' as const, custom: false }];
    await perspectiveRepository.updateJob(job.id, { dimensions: next, questionCount: 15 });
    const updated = await perspectiveRepository.findJob(job.id);
    expect(updated!.dimensions).toHaveLength(3);
    expect(updated!.questionCount).toBe(15);
  });

  it('删除岗位会级联删掉候选人和评价', async () => {
    const job = await createJob();
    const candidate = await perspectiveRepository.createCandidate({ jobId: job.id, name: '张三' });
    await perspectiveRepository.upsertEvaluation({
      candidateId: candidate!.id,
      overallScore: 80,
      dimensionScores: [],
      questionEvaluations: [],
      recommendation: 'hire',
      recommendationReason: '基础扎实',
      strengths: ['沟通清晰'],
      concerns: [],
      overallComment: '整体不错',
    });

    await perspectiveRepository.deleteJob(job.id);

    expect(await perspectiveRepository.findCandidate(candidate!.id)).toBeNull();
    expect(await db.select().from(perspectiveEvaluations)).toHaveLength(0);
  });
});

describe('perspectiveRepository — candidates', () => {
  it('新建候选人默认是 pending 状态且没有题目', async () => {
    const job = await createJob();
    const candidate = await perspectiveRepository.createCandidate({ jobId: job.id, name: '李四' });
    expect(candidate!.status).toBe('pending');
    expect(candidate!.questions).toBeNull();
    expect(candidate!.transcript).toBe('');
  });

  it('写入题目后能原样读回', async () => {
    const job = await createJob();
    const candidate = await perspectiveRepository.createCandidate({ jobId: job.id, name: '王五' });
    const questions = [
      {
        id: 'q1',
        dimension: 'logic',
        category: 'project_deep_dive' as const,
        source: 'resume' as const,
        evidence: '简历中的线上故障排查经历',
        question: '讲一个你排查过的线上问题',
        intent: '看拆解问题的路径',
        rubric: { excellent: '有假设有验证', pass: '能说清现象', fail: '只会复述结论' },
        followUps: [{ purpose: '要细节', question: '当时为什么先怀疑这里？', answer: '' }],
        referencePoints: ['定位手段', '验证方式'],
        redFlags: undefined,
        estimatedMinutes: 8,
        difficulty: 'medium' as const,
        status: 'pending' as const,
      },
    ];
    await perspectiveRepository.updateCandidate(candidate!.id, {
      questions,
      status: 'questions_ready',
    });
    const updated = await perspectiveRepository.findCandidate(candidate!.id);
    // 行→题目会补上默认字段（sortOrder/score/tier 等），原字段必须无损
    expect(updated!.questions).toHaveLength(1);
    expect(updated!.questions![0]).toMatchObject(questions[0]);
    expect(updated!.status).toBe('questions_ready');
  });

  it('候选人摘要列表带出评价的分数和结论，不带大 JSON', async () => {
    const job = await createJob();
    const scored = await perspectiveRepository.createCandidate({ jobId: job.id, name: '有评价的' });
    await perspectiveRepository.createCandidate({ jobId: job.id, name: '没评价的' });
    await perspectiveRepository.upsertEvaluation({
      candidateId: scored!.id,
      overallScore: 88,
      dimensionScores: [],
      questionEvaluations: [],
      recommendation: 'strong_hire',
      recommendationReason: '很强',
      strengths: [],
      concerns: [],
      overallComment: '',
    });

    const summaries = await perspectiveRepository.findCandidateSummaries(job.id);
    expect(summaries).toHaveLength(2);
    const withScore = summaries.find((s) => s.name === '有评价的')!;
    const without = summaries.find((s) => s.name === '没评价的')!;
    expect(withScore.overallScore).toBe(88);
    expect(withScore.recommendation).toBe('strong_hire');
    expect(without.overallScore).toBeNull();
    expect(without.recommendation).toBeNull();
  });
});

describe('perspectiveRepository — evaluations', () => {
  it('重复生成评价时覆盖旧的，而不是插第二条', async () => {
    const job = await createJob();
    const candidate = await perspectiveRepository.createCandidate({ jobId: job.id, name: '赵六' });

    await perspectiveRepository.upsertEvaluation({
      candidateId: candidate!.id,
      overallScore: 60,
      dimensionScores: [],
      questionEvaluations: [],
      recommendation: 'hold',
      recommendationReason: '待定',
      strengths: [],
      concerns: [],
      overallComment: '第一版',
    });
    await perspectiveRepository.upsertEvaluation({
      candidateId: candidate!.id,
      overallScore: 85,
      dimensionScores: [],
      questionEvaluations: [],
      recommendation: 'hire',
      recommendationReason: '重新评估后认可',
      strengths: [],
      concerns: [],
      overallComment: '第二版',
    });

    const rows = await db.select().from(perspectiveEvaluations);
    expect(rows).toHaveLength(1);
    const latest = await perspectiveRepository.findEvaluation(candidate!.id);
    expect(latest!.overallScore).toBe(85);
    expect(latest!.overallComment).toBe('第二版');
  });

  it('候选人不存在时查评价返回 null', async () => {
    expect(await perspectiveRepository.findEvaluation('nope')).toBeNull();
  });
});

describe('legacy question backfill', () => {
  const LEGACY_QUESTIONS = [
    {
      id: 'legacy-q1',
      dimension: 'project_deep_dive',
      category: 'project_deep_dive' as const,
      source: 'resume' as const,
      evidence: '简历里的订单系统',
      question: '讲讲你在订单系统里的角色',
      intent: '看个人贡献',
      rubric: { excellent: '有量化结果', pass: '说得清职责', fail: '只有团队视角' },
      followUps: ['当时为什么选这个方案？', { purpose: '要细节', question: '指标怎么来的？', answer: '' }],
      referencePoints: ['职责边界', '量化结果'],
      referenceAnswer: '分点说明',
      redFlags: ['全程用我们'],
      estimatedMinutes: 8,
      difficulty: 'hard' as const,
      answer: '我是核心开发',
      status: 'answered' as const,
    },
  ];

  it('把 JSON 题目迁成行且字段无损，迁完把 JSON 列置空', async () => {
    const job = await createJob();
    const candidate = await perspectiveRepository.createCandidate({ jobId: job.id, name: '迁移对象' });

    // 直接写 JSON 列，模拟翻转之前的数据
    await db
      .update(perspectiveCandidates)
      .set({ questions: LEGACY_QUESTIONS } as any)
      .where(eq(perspectiveCandidates.id, candidate!.id));

    const migrated = await backfillLegacyQuestions(db);
    expect(migrated).toBe(1);

    const rows = await db.select().from(interviewQuestions);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.id).toBe('legacy-q1');
    expect(row.perspectiveCandidateId).toBe(candidate!.id);
    expect(row.dimensionKey).toBe('project_deep_dive');
    expect(row.category).toBe('project_deep_dive');
    expect(row.source).toBe('resume');
    expect(row.evidence).toBe('简历里的订单系统');
    expect(row.estimatedMinutes).toBe(8);
    expect(row.difficulty).toBe('hard');
    expect(row.answer).toBe('我是核心开发');
    expect(row.status).toBe('answered');
    // 字符串形式的追问被补成对象，字段没丢
    expect(row.followUps).toEqual([
      { purpose: '', question: '当时为什么选这个方案？', answer: '' },
      { purpose: '要细节', question: '指标怎么来的？', answer: '' },
    ]);

    // JSON 列已清空，仓库改从 interview_questions 读回同样的题目
    const reloaded = await perspectiveRepository.findCandidate(candidate!.id);
    expect(reloaded!.questions).toHaveLength(1);
    expect(reloaded!.questions![0].question).toBe('讲讲你在订单系统里的角色');
  });

  it('重复执行是幂等的，不会插出第二份', async () => {
    const job = await createJob();
    const candidate = await perspectiveRepository.createCandidate({ jobId: job.id, name: '幂等' });
    await db
      .update(perspectiveCandidates)
      .set({ questions: LEGACY_QUESTIONS } as any)
      .where(eq(perspectiveCandidates.id, candidate!.id));

    await backfillLegacyQuestions(db);
    await backfillLegacyQuestions(db);

    expect(await db.select().from(interviewQuestions)).toHaveLength(1);
  });

  it('仓库写入题目走 interview_questions，而不是 JSON 列', async () => {
    const job = await createJob();
    const candidate = await perspectiveRepository.createCandidate({ jobId: job.id, name: '写入' });

    await perspectiveRepository.updateCandidate(candidate!.id, { questions: LEGACY_QUESTIONS as any });

    expect(await db.select().from(interviewQuestions)).toHaveLength(1);
    const raw = await db
      .select({ questions: perspectiveCandidates.questions })
      .from(perspectiveCandidates)
      .where(eq(perspectiveCandidates.id, candidate!.id));
    expect(raw[0].questions).toBeNull();
  });
});
