ALTER TABLE `perspective_evaluations` ADD `status` text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE `perspective_candidates` DROP COLUMN `questions`;