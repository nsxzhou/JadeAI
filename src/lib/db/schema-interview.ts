import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users, resumes } from './schema';

export const interviewSessions = sqliteTable('interview_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  resumeId: text('resume_id').references(() => resumes.id),
  jobDescription: text('job_description').notNull(),
  jobTitle: text('job_title').notNull().default(''),
  selectedInterviewers: text('selected_interviewers', { mode: 'json' }).notNull().default('[]'),
  currentRound: integer('current_round').notNull().default(0),
  status: text('status', { enum: ['preparing', 'in_progress', 'paused', 'completed'] }).notNull().default('preparing'),
  /** 岗位族（老会话为 NULL，视图按 other 处理，不进族层画像） */
  roleFamilyKey: text('role_family_key'),
  primaryStack: text('primary_stack'),
  /** 题数预设 short | standard | long */
  questionCountPreset: text('question_count_preset'),
  /**
   * 每题限时（秒）。NULL = 不限时；默认 180。
   *
   * 老会话由迁移回填 180，因此 NULL 只代表用户显式选择了「不限时」。
   */
  questionTimeLimitSec: integer('question_time_limit_sec').default(180),
  /** 整场限时 = 题数 × 每题限时 × 1.1；不限时为 NULL */
  totalTimeLimitSec: integer('total_time_limit_sec'),
  /** 当前题，供「中断后恢复」 */
  currentQuestionId: text('current_question_id'),
  /** 压力面强度 gentle | standard | sharp */
  stressLevel: text('stress_level').notNull().default('gentle'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const interviewRounds = sqliteTable('interview_rounds', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => interviewSessions.id, { onDelete: 'cascade' }),
  interviewerType: text('interviewer_type').notNull(),
  interviewerConfig: text('interviewer_config', { mode: 'json' }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  status: text('status', { enum: ['pending', 'in_progress', 'completed', 'skipped'] }).notNull().default('pending'),
  questionCount: integer('question_count').notNull().default(0),
  maxQuestions: integer('max_questions').notNull().default(10),
  summary: text('summary', { mode: 'json' }),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const interviewMessages = sqliteTable('interview_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  roundId: text('round_id').notNull().references(() => interviewRounds.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['interviewer', 'candidate', 'system'] }).notNull(),
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }).default('{}'),
  /** 该消息属于哪道题（含追问消息），报告追溯靠这一列 */
  questionId: text('question_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const interviewReports = sqliteTable('interview_reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => interviewSessions.id, { onDelete: 'cascade' }).unique(),
  overallScore: integer('overall_score').notNull(),
  dimensionScores: text('dimension_scores', { mode: 'json' }).notNull(),
  roundEvaluations: text('round_evaluations', { mode: 'json' }).notNull(),
  overallFeedback: text('overall_feedback').notNull(),
  improvementPlan: text('improvement_plan', { mode: 'json' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});
