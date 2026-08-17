ALTER TABLE `routines` ADD `missed_run_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `routines` ADD `last_missed_at` integer;