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
const { backfillPerspectiveCoordinates } = await import('../backfill-perspective-coordinates');
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

describe('backsfill 旧坐标 → 两层坐标', () => {
  it('旧岗位的 weight 变成题数，岗位族与栈被显式落库', async () => {
    const job = await perspectiveRepository.createJob({
      userId: USER_ID,
      title: 'Go 后端工程师',
      jobDescription: '负责 Go 微服务开发',
      dimensions: [
        { key: 'go_fundamentals', label: 'Go 基础', weight: 3, layer: 'family' as const, custom: false },
        { key: 'hr_motivation', label: '求职动机', weight: 2, layer: 'family' as const, custom: false },
      ],
      questionCount: 5,
    });

    const result = await backfillPerspectiveCoordinates(db);
    expect(result.jobs).toBe(1);

    const row = (await db.select().from(perspectiveJobs).where(eq(perspectiveJobs.id, job!.id)))[0];
    expect(row.roleFamilyKey).toBe('backend');
    expect(row.primaryStack).toBe('go');
    const counts = row.questionCounts as Record<string, number>;
    expect(counts.go_fundamentals).toBe(3);
    // 求职动机没有独立评分坐标：题数归并到沟通表达
    expect(counts.general_communication).toBeGreaterThanOrEqual(2);
    expect(row.questionCount).toBe(Object.values(counts).reduce((sum, n) => sum + n, 0));
    // 旧 key 不再留在 dimensions 里
    const keys = (row.dimensions as Array<{ key: string }>).map((dimension) => dimension.key);
    expect(keys).not.toContain('hr_motivation');
    expect(keys).toContain('general_communication');
  });

  it('存量题目的旧维度 key 被重映射，重复执行无变化', async () => {
    const job = await perspectiveRepository.createJob({
      userId: USER_ID,
      title: '后端工程师',
      jobDescription: '服务端开发',
      dimensions: [{ key: 'go_fundamentals', label: 'Go 基础', weight: 2, layer: 'family' as const, custom: false }],
      questionCount: 5,
    });
    const candidate = await perspectiveRepository.createCandidate({ jobId: job!.id, name: '题目归位' });
    await perspectiveRepository.replaceQuestions(candidate!.id, [
      {
        dimension: 'hr_motivation',
        question: '为什么选我们',
        intent: '看动机',
        rubric: { excellent: '', pass: '', fail: '' },
        followUps: [],
        referencePoints: [],
        estimatedMinutes: 5,
        difficulty: 'easy',
      },
      {
        dimension: 'communication_pressure',
        question: '被质疑时怎么办',
        intent: '看抗压',
        rubric: { excellent: '', pass: '', fail: '' },
        followUps: [],
        referencePoints: [],
        estimatedMinutes: 5,
        difficulty: 'easy',
      },
    ]);

    await backfillPerspectiveCoordinates(db);
    const first = await perspectiveRepository.findQuestionsByCandidateId(candidate!.id);
    expect(first.map((question) => question.dimension)).toEqual(['general_communication', 'general_stress']);

    await backfillPerspectiveCoordinates(db);
    const second = await perspectiveRepository.findQuestionsByCandidateId(candidate!.id);
    expect(second.map((question) => question.dimension)).toEqual(first.map((question) => question.dimension));
  });

  it('题目只写 interview_questions，不依赖已删除的 JSON 列', async () => {
    const job = await createJob();
    const candidate = await perspectiveRepository.createCandidate({ jobId: job.id, name: '写入' });

    await perspectiveRepository.updateCandidate(candidate!.id, {
      questions: [{
        dimension: 'project_deep_dive',
        question: '讲讲你的项目',
        intent: '看深度',
        rubric: { excellent: '', pass: '', fail: '' },
        followUps: [],
        referencePoints: [],
        estimatedMinutes: 5,
        difficulty: 'medium',
      }],
    });

    const rows = await db.select().from(interviewQuestions);
    expect(rows).toHaveLength(1);
    expect(rows[0].perspectiveCandidateId).toBe(candidate!.id);
  });
});

describe('两段式评价的落库', () => {
  it('逐题分写回 interview_questions，reset 清掉评价', async () => {
    const job = await createJob();
    const candidate = await perspectiveRepository.createCandidate({ jobId: job.id, name: '分块' });
    await perspectiveRepository.replaceQuestions(candidate!.id, [{
      id: 'q-1',
      dimension: 'project_deep_dive',
      question: '讲讲你的项目',
      intent: '看深度',
      rubric: { excellent: '', pass: '', fail: '' },
      followUps: [],
      referencePoints: [],
      estimatedMinutes: 5,
      difficulty: 'medium',
    }]);

    await perspectiveRepository.updateQuestionScore('q-1', { tier: 'pass', score: 72 });
    const [scored] = await perspectiveRepository.findQuestionsByCandidateId(candidate!.id);
    expect(scored.score).toBe(72);
    expect(scored.tier).toBe('pass');

    await perspectiveRepository.saveEvaluationChunk(candidate!.id, [{
      questionId: 'q-1',
      question: '讲讲你的项目',
      answerSummary: '说清了个人贡献',
      answered: true,
      tier: 'pass',
      score: 72,
      highlights: ['有量化结果'],
      weaknesses: ['没讲失败'],
    }]);

    const partial = await perspectiveRepository.findEvaluation(candidate!.id);
    expect(partial!.status).toBe('partial');
    expect((partial!.questionEvaluations as Array<{ questionId: string }>)).toHaveLength(1);

    // 再存一块时按 questionId 合并，不覆盖前一块
    await perspectiveRepository.saveEvaluationChunk(candidate!.id, [{
      questionId: 'q-2',
      question: '讲讲一次事故',
      answerSummary: '定位过程清楚',
      answered: true,
      tier: 'excellent',
      score: 90,
      highlights: [],
      weaknesses: [],
    }]);
    const merged = await perspectiveRepository.findEvaluation(candidate!.id);
    expect((merged!.questionEvaluations as Array<{ questionId: string }>)).toHaveLength(2);

    await perspectiveRepository.resetEvaluation(candidate!.id);
    expect(await perspectiveRepository.findEvaluation(candidate!.id)).toBeNull();
  });
});
