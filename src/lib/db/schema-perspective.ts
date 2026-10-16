import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './schema';

/**
 * 面试官视角（原「招聘侧」）的三张表。
 *
 * 语义已翻转：使用者是求职者本人。`perspective_jobs` 是「我的目标岗位」，
 * `perspective_candidates` 是「我针对某目标岗位的一份简历分析」，
 * `perspective_evaluations` 是「该次推演的结论」。
 */

export const perspectiveJobs = sqliteTable('perspective_jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  jobDescription: text('job_description').notNull(),
  /** 两层评分坐标（通用层 + 族层），weight 只表评分口径 */
  dimensions: text('dimensions', { mode: 'json' }).notNull().default('[]'),
  /** 目标岗位所在的岗位族 */
  roleFamilyKey: text('role_family_key'),
  primaryStack: text('primary_stack'),
  /** 逐维度题数（面试官视角可调）；null 时由 planQuestionCounts 推导 */
  questionCounts: text('question_counts', { mode: 'json' }),
  questionCount: integer('question_count').notNull().default(10),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const perspectiveCandidates = sqliteTable('perspective_candidates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  jobId: text('job_id').notNull().references(() => perspectiveJobs.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default(''),
  status: text('status', { enum: ['pending', 'questions_ready', 'evaluated'] })
    .notNull()
    .default('pending'),
  resumeText: text('resume_text').notNull().default(''),
  resumeData: text('resume_data', { mode: 'json' }),
  /** 阶段 5 起题目落 interview_questions，读取逐步停止依赖这一列，最后 DROP */
  questions: text('questions', { mode: 'json' }),
  transcript: text('transcript').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const perspectiveEvaluations = sqliteTable('perspective_evaluations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  candidateId: text('candidate_id')
    .notNull()
    .references(() => perspectiveCandidates.id, { onDelete: 'cascade' })
    .unique(),
  overallScore: integer('overall_score').notNull(),
  dimensionScores: text('dimension_scores', { mode: 'json' }).notNull(),
  questionEvaluations: text('question_evaluations', { mode: 'json' }).notNull(),
  recommendation: text('recommendation', {
    enum: ['strong_hire', 'hire', 'hold', 'no_hire'],
  }).notNull(),
  recommendationReason: text('recommendation_reason').notNull().default(''),
  strengths: text('strengths', { mode: 'json' }).notNull().default('[]'),
  concerns: text('concerns', { mode: 'json' }).notNull().default('[]'),
  overallComment: text('overall_comment').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});
