CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`action` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_routine_id` text,
	`contact_id` text,
	`repo_path` text NOT NULL,
	`persona_template_id` text,
	`summary` text NOT NULL,
	`metadata` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_events_repo_path_created_idx` ON `audit_events` (`repo_path`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_contact_created_idx` ON `audit_events` (`contact_id`,`created_at`);