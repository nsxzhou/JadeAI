import { sqliteTable, text, integer, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { interviewRounds } from './schema-interview';
import { perspectiveCandidates } from './schema-perspective';

/**
 * 题目实体。
 *
 * 题目从「对话里的字符串」升格为实体，是错题本与「报告里每个数字可追溯」的共同前提。
 * 两个模式共用这一张表，归属由双可空外键区分：候选人侧指向 `interview_rounds`，
 * 面试官视角指向 `perspective_candidates`，CHECK 保证恰好属于一方。
 */
export const interviewQuestions = sqliteTable('interview_questions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  roundId: text('round_id').references(() => interviewRounds.id, { onDelete: 'cascade' }),
  perspectiveCandidateId: text('perspective_candidate_id')
    .references(() => perspectiveCandidates.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  /** 计入哪个评分坐标（DimensionConfig.key） */
  dimensionKey: text('dimension_key').notNull(),
  /** 题型。题型决定怎么问，与评分坐标解耦。 */
  category: text('category'),
  /** 事实来源：resume | jd | gap */
  source: text('source'),
  evidence: text('evidence').notNull().default(''),
  question: text('question').notNull(),
  intent: text('intent').notNull().default(''),
  rubric: text('rubric', { mode: 'json' }).notNull().default('{}'),
  followUps: text('follow_ups', { mode: 'json' }).notNull().default('[]'),
  referencePoints: text('reference_points', { mode: 'json' }).notNull().default('[]'),
  referenceAnswer: text('reference_answer').notNull().default(''),
  redFlags: text('red_flags', { mode: 'json' }),
  estimatedMinutes: integer('estimated_minutes').notNull().default(5),
  difficulty: text('difficulty').notNull().default('medium'),
  answer: text('answer').notNull().default(''),
  timeSpentSec: integer('time_spent_sec'),
  timedOut: integer('timed_out', { mode: 'boolean' }).notNull().default(false),
  /** AI 给的档位；服务端 clamp 后的分数写在 score */
  tier: text('tier'),
  score: integer('score'),
  markedWeak: integer('marked_weak', { mode: 'boolean' }).notNull().default(false),
  status: text('status').notNull().default('pending'),
  /** 重练链：这道题复制自哪道原题 */
  originQuestionId: text('origin_question_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => [
  check(
    'interview_questions_owner_check',
    sql`(${table.roundId} IS NULL) <> (${table.perspectiveCandidateId} IS NULL)`,
  ),
]);
