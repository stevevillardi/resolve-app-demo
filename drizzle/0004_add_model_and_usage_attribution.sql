ALTER TABLE `persona_templates` ADD `model` text;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `model` text;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `cost_source` text;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `cache_write_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `reasoning_output_tokens` integer;