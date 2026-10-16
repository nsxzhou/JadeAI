-- 面试官视角翻转：三张表改名，语义从「招聘」变为「目标岗位 / 我的简历分析 / 推演结论」。
-- drizzle-kit 不识别改名，会生成 DROP + CREATE；这里手写成 ALTER TABLE RENAME，
-- 顺序很重要：先改父表，SQLite 会同步改写子表里的外键引用。
ALTER TABLE `recruit_jobs` RENAME TO `perspective_jobs`;--> statement-breakpoint
ALTER TABLE `recruit_candidates` RENAME TO `perspective_candidates`;--> statement-breakpoint
ALTER TABLE `recruit_evaluations` RENAME TO `perspective_evaluations`;--> statement-breakpoint
ALTER TABLE `perspective_jobs` ADD `role_family_key` text;--> statement-breakpoint
ALTER TABLE `perspective_jobs` ADD `primary_stack` text;--> statement-breakpoint
ALTER TABLE `perspective_jobs` ADD `question_counts` text;--> statement-breakpoint
-- 候选人级维度覆盖在翻转后失去意义（真实使用中从未被用过，UI 也从未暴露）。
ALTER TABLE `perspective_candidates` DROP COLUMN `dimensions_override`;--> statement-breakpoint
DROP INDEX `recruit_evaluations_candidate_id_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `perspective_evaluations_candidate_id_unique` ON `perspective_evaluations` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `interview_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text,
	`perspective_candidate_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`dimension_key` text NOT NULL,
	`category` text,
	`source` text,
	`evidence` text DEFAULT '' NOT NULL,
	`question` text NOT NULL,
	`intent` text DEFAULT '' NOT NULL,
	`rubric` text DEFAULT '{}' NOT NULL,
	`follow_ups` text DEFAULT '[]' NOT NULL,
	`reference_points` text DEFAULT '[]' NOT NULL,
	`reference_answer` text DEFAULT '' NOT NULL,
	`red_flags` text,
	`estimated_minutes` integer DEFAULT 5 NOT NULL,
	`difficulty` text DEFAULT 'medium' NOT NULL,
	`answer` text DEFAULT '' NOT NULL,
	`time_spent_sec` integer,
	`timed_out` integer DEFAULT false NOT NULL,
	`tier` text,
	`score` integer,
	`marked_weak` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`origin_question_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `interview_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`perspective_candidate_id`) REFERENCES `perspective_candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "interview_questions_owner_check" CHECK(("interview_questions"."round_id" IS NULL) <> ("interview_questions"."perspective_candidate_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE `interview_messages` ADD `question_id` text;--> statement-breakpoint
ALTER TABLE `interview_rounds` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `interview_rounds` ADD `finished_at` integer;--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `role_family_key` text;--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `primary_stack` text;--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `question_count_preset` text;--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `total_time_limit_sec` integer;--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `current_question_id` text;--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `stress_level` text DEFAULT 'gentle' NOT NULL;--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `started_at` integer;
