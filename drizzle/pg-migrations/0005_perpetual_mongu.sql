ALTER TABLE "recruit_jobs" RENAME TO "perspective_jobs";--> statement-breakpoint
ALTER TABLE "recruit_candidates" RENAME TO "perspective_candidates";--> statement-breakpoint
ALTER TABLE "recruit_evaluations" RENAME TO "perspective_evaluations";--> statement-breakpoint
ALTER TABLE "perspective_jobs" ADD COLUMN "role_family_key" text;--> statement-breakpoint
ALTER TABLE "perspective_jobs" ADD COLUMN "primary_stack" text;--> statement-breakpoint
ALTER TABLE "perspective_jobs" ADD COLUMN "question_counts" text;--> statement-breakpoint
-- 候选人级维度覆盖在翻转后失去意义（真实使用中从未被用过）。--> statement-breakpoint
ALTER TABLE "perspective_candidates" DROP COLUMN "dimensions_override";--> statement-breakpoint
ALTER INDEX "recruit_evaluations_candidate_id_unique" RENAME TO "perspective_evaluations_candidate_id_unique";--> statement-breakpoint
CREATE TABLE "interview_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text,
	"perspective_candidate_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"dimension_key" text NOT NULL,
	"category" text,
	"source" text,
	"evidence" text DEFAULT '' NOT NULL,
	"question" text NOT NULL,
	"intent" text DEFAULT '' NOT NULL,
	"rubric" text DEFAULT '{}' NOT NULL,
	"follow_ups" text DEFAULT '[]' NOT NULL,
	"reference_points" text DEFAULT '[]' NOT NULL,
	"reference_answer" text DEFAULT '' NOT NULL,
	"red_flags" text,
	"estimated_minutes" integer DEFAULT 5 NOT NULL,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"time_spent_sec" integer,
	"timed_out" integer DEFAULT 0 NOT NULL,
	"tier" text,
	"score" integer,
	"marked_weak" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"origin_question_id" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
,
	CONSTRAINT "interview_questions_owner_check" CHECK(("round_id" IS NULL) <> ("perspective_candidate_id" IS NULL))
);--> statement-breakpoint
ALTER TABLE "interview_messages" ADD COLUMN "question_id" text;--> statement-breakpoint
ALTER TABLE "interview_rounds" ADD COLUMN "started_at" integer;--> statement-breakpoint
ALTER TABLE "interview_rounds" ADD COLUMN "finished_at" integer;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "role_family_key" text;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "primary_stack" text;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "question_count_preset" text;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "total_time_limit_sec" integer;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "current_question_id" text;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "stress_level" text DEFAULT 'gentle' NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "started_at" integer;
