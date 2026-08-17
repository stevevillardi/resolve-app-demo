ALTER TABLE `group_messages` ADD `resolved_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `work` text;--> statement-breakpoint
ALTER TABLE `tool_calls` ADD `detail` text;--> statement-breakpoint
ALTER TABLE `tool_calls` ADD `output` text;