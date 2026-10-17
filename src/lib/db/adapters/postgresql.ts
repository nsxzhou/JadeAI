import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { DatabaseAdapter } from '../adapter';
import { resolve } from 'path';

export class PostgreSQLAdapter implements DatabaseAdapter {
  db;
  private client: ReturnType<typeof postgres>;

  constructor(connectionString: string) {
    this.client = postgres(connectionString);
    this.db = drizzle(this.client);
  }

  async initialize(): Promise<void> {
    // Auto-run migrations (PG-native migration files)
    try {
      await migrate(this.db, {
        migrationsFolder: resolve(process.cwd(), 'drizzle/pg-migrations'),
      });

      // Sanity check: if migration tracking says "done" but tables are missing
      // (e.g. after a manual DROP SCHEMA), reset tracking and re-run
      const check = await this.db.execute(
        sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS ok`
      );
      if (!(check as any)[0]?.ok) {
        console.warn('[DB] Migration tracking is stale — resetting and re-running');
        await this.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
        await migrate(this.db, {
          migrationsFolder: resolve(process.cwd(), 'drizzle/pg-migrations'),
        });
      }

      console.log('[DB] PostgreSQL migrations applied');
    } catch (e) {
      console.error('[DB] PostgreSQL migration failed:', e);
    }

    // 旧面试官视角坐标 → 两层坐标（岗位族 / 语言栈 / 逐维度题数）。
    // 幂等：已经回填过的岗位直接跳过。
    try {
      const { backfillPerspectiveCoordinates } = await import('../backfill-perspective-coordinates');
      await backfillPerspectiveCoordinates(this.db);
    } catch (e) {
      console.error('[DB] perspective coordinate backfill failed:', e);
    }

    // Auto-seed if empty
    try {
      const result = await this.db.execute(sql`SELECT count(*)::int as count FROM users`);
      const count = Number((result as any)[0]?.count ?? 0);
      if (count === 0) {
        const { seedDemoUser } = await import('../seed-demo');
        await seedDemoUser(this.db);
        console.log('[DB] PostgreSQL auto-seed complete');
      }
    } catch (e) {
      console.error('[DB] PostgreSQL auto-seed failed:', e);
    }
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
