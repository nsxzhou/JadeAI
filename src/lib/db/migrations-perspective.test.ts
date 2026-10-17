import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const MIGRATIONS = 'drizzle/migrations';

/**
 * 把迁移目录复制一份，只保留前 `upTo` 条。
 *
 * 翻转改名（0007）必须在**已有数据的旧库**上生效，而不是只在空库上跑通。
 * 这里先迁到改名之前，塞进旧结构的数据，再单独执行改名那一条。
 */
function copyMigrationsUpTo(upTo: number): { folder: string; journalTags: string[] } {
  const folder = mkdtempSync(join(tmpdir(), 'jade-migrate-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
  const entries = journal.entries.filter((e: { idx: number }) => e.idx <= upTo);
  for (const entry of entries) {
    copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  return { folder, journalTags: entries.map((e: { tag: string }) => e.tag) };
}

function applySqlFile(sqlite: Database.Database, file: string) {
  const sql = readFileSync(file, 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) sqlite.exec(statement);
  }
}

const perspectiveMigration = readdirSync(MIGRATIONS).find((f) => f.startsWith('0007_'))!;
/** 本次收尾：删掉旧 JSON 列、给评价加 status。 */
const coordinatesMigration = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .at(-1)!;

describe('perspective rename migration', () => {
  it('在旧库上改名并保留数据，随后不再有旧表', () => {
    const { folder } = copyMigrationsUpTo(6);
    const sqlite = new Database(join(folder, 'old.db'));
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: folder });

    // 旧结构：recruit_* 三张表 + dimensions_override + questions JSON
    sqlite.exec(`
      INSERT INTO users (id, auth_type) VALUES ('u1', 'local');
      INSERT INTO recruit_jobs (id, user_id, title, job_description, dimensions, question_count)
        VALUES ('j1', 'u1', '后端工程师', 'JD 正文', '[{"key":"professional","weight":3}]', 5);
      INSERT INTO recruit_candidates (id, job_id, name, status, dimensions_override, questions)
        VALUES ('c1', 'j1', '我的简历', 'questions_ready', '[{"key":"logic","weight":2}]',
                '[{"id":"q1","dimension":"logic","question":"讲讲你的项目"}]');
      INSERT INTO recruit_evaluations (id, candidate_id, overall_score, dimension_scores, question_evaluations, recommendation)
        VALUES ('e1', 'c1', 80, '[]', '[]', 'hire');
    `);

    applySqlFile(sqlite, join(MIGRATIONS, perspectiveMigration));

    // 表已改名，数据仍在
    const jobs = sqlite.prepare('SELECT id, title, job_description, question_count FROM perspective_jobs').all() as Array<Record<string, unknown>>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('后端工程师');
    expect(jobs[0].job_description).toBe('JD 正文');
    expect(jobs[0].question_count).toBe(5);

    const candidates = sqlite.prepare('SELECT id, name, questions FROM perspective_candidates').all() as Array<Record<string, unknown>>;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe('我的简历');
    // 题目 JSON 列在回填完成之前先保留
    expect(String(candidates[0].questions)).toContain('讲讲你的项目');

    const evaluations = sqlite.prepare('SELECT id, overall_score FROM perspective_evaluations').all() as Array<Record<string, unknown>>;
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0].overall_score).toBe(80);

    // 旧表与旧列都不在了
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).not.toContain('recruit_jobs');
    expect(names).not.toContain('recruit_candidates');
    expect(names).not.toContain('recruit_evaluations');
    expect(names).toContain('interview_questions');

    const columns = sqlite.prepare('PRAGMA table_info(perspective_candidates)').all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).not.toContain('dimensions_override');

    // 新列可用
    sqlite.exec(`UPDATE perspective_jobs SET role_family_key = 'backend', primary_stack = 'go', question_counts = '{}' WHERE id = 'j1'`);
    const updated = sqlite.prepare('SELECT role_family_key, primary_stack FROM perspective_jobs WHERE id = \'j1\'').get() as Record<string, unknown>;
    expect(updated.role_family_key).toBe('backend');
    expect(updated.primary_stack).toBe('go');

    // 二选一约束真实生效
    expect(() =>
      sqlite.exec(`INSERT INTO interview_questions (id, question, dimension_key) VALUES ('bad', 'q', 'd')`),
    ).toThrow();
    expect(() =>
      sqlite.exec(`INSERT INTO interview_questions (id, question, dimension_key, round_id, perspective_candidate_id) VALUES ('bad2', 'q', 'd', 'r', 'c1')`),
    ).toThrow();
    sqlite.exec(`INSERT INTO interview_questions (id, question, dimension_key, perspective_candidate_id) VALUES ('ok', 'q', 'logic', 'c1')`);
    expect(sqlite.prepare('SELECT count(*) as n FROM interview_questions').get()).toEqual({ n: 1 });

    sqlite.close();
  });
});

describe('perspective coordinates migration', () => {
  it('删掉旧的 questions JSON 列，评价加上 status 且默认 complete', () => {
    const folder = mkdtempSync(join(tmpdir(), 'jade-migrate-'));
    mkdirSync(join(folder, 'meta'), { recursive: true });
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
    // 迁到「删列之前」的所有迁移
    const entries = journal.entries.filter((e: { tag: string }) => e.tag !== coordinatesMigration.replace('.sql', ''));
    for (const entry of entries) {
      copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    }
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }, null, 2));

    const sqlite = new Database(join(folder, 'before.db'));
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: folder });

    // 旧库里还有 JSON 列与没有 status 的评价
    sqlite.exec(`
      INSERT INTO users (id, auth_type) VALUES ('u1', 'local');
      INSERT INTO perspective_jobs (id, user_id, title, job_description, dimensions, question_count)
        VALUES ('j1', 'u1', '后端工程师', 'JD 正文', '[]', 5);
      INSERT INTO perspective_candidates (id, job_id, name, questions)
        VALUES ('c1', 'j1', '我的简历', '[]');
      INSERT INTO perspective_evaluations (id, candidate_id, overall_score, dimension_scores, question_evaluations, recommendation)
        VALUES ('e1', 'c1', 80, '[]', '[]', 'hire');
    `);

    applySqlFile(sqlite, join(MIGRATIONS, coordinatesMigration));

    const columns = sqlite.prepare('PRAGMA table_info(perspective_candidates)').all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).not.toContain('questions');

    const evaluation = sqlite.prepare('SELECT status FROM perspective_evaluations WHERE id = \'e1\'').get() as Record<string, unknown>;
    expect(evaluation.status).toBe('complete');

    sqlite.close();
  });
});
