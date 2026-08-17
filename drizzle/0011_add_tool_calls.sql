CREATE TABLE `tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`message_id` text,
	`tool_call_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tool_calls_contact_created_idx` ON `tool_calls` (`contact_id`,`created_at`);