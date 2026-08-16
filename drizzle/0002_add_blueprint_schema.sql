CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_template_id` text NOT NULL,
	`repo_path` text NOT NULL,
	`display_name` text NOT NULL,
	`backend_session_id` text,
	FOREIGN KEY (`persona_template_id`) REFERENCES `persona_templates`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `contacts_repo_path_idx` ON `contacts` (`repo_path`);--> statement-breakpoint
CREATE TABLE `group_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`type` text NOT NULL,
	`contact_id` text,
	`content` text NOT NULL,
	`category` text,
	`durable` integer,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `group_messages_group_timestamp_idx` ON `group_messages` (`group_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_path` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_repo_path_unique` ON `groups` (`repo_path`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_contact_timestamp_idx` ON `messages` (`contact_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `persona_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`avatar_color` text NOT NULL,
	`backend` text NOT NULL,
	`system_prompt` text NOT NULL,
	`skill_ids` text NOT NULL,
	`sandbox` text NOT NULL,
	`github_scope` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`schedule` text NOT NULL,
	`prompt` text NOT NULL,
	`enabled` integer NOT NULL,
	`last_run_at` integer,
	`last_run_summary` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `routines_contact_idx` ON `routines` (`contact_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`source` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cached_input_tokens` integer,
	`cost_usd` real,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_events_contact_timestamp_idx` ON `usage_events` (`contact_id`,`timestamp`);