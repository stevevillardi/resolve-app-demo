-- Rebuilds usage_events so a deleted Contact leaves its spend behind.
--
-- SQLite cannot alter a foreign key, so changing ON DELETE from cascade to set
-- null means the 12-step table rebuild below. Two things about it are worth
-- knowing before editing:
--
-- 1. The PRAGMA statements are no-ops here. drizzle's migrate() wraps every
--    pending statement in a single transaction, and SQLite ignores
--    `PRAGMA foreign_keys` inside one — create.ts has already turned foreign
--    keys ON for the connection, so this rebuild runs with enforcement live.
--    That is survivable only because usage_events is a pure child: nothing
--    references it, so neither the DROP nor the RENAME can strand anything.
--    The same rebuild applied to a *parent* table would not be safe.
-- 2. DROP TABLE takes the index with it, so it is recreated at the end.
--
-- The INSERT is hand-edited away from what drizzle-kit generated. Its version
-- selected persona_template_id and repo_path from the old table, which does not
-- have them; joining contacts instead backfills every historical row, so no
-- existing spend is left unattributed by the migration that makes attribution
-- survivable.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text,
	`persona_template_id` text,
	`repo_path` text,
	`timestamp` integer NOT NULL,
	`source` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cached_input_tokens` integer,
	`cost_usd` real,
	`model` text,
	`cost_source` text,
	`cache_write_input_tokens` integer,
	`reasoning_output_tokens` integer,
	`session_id` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_usage_events`("id", "contact_id", "persona_template_id", "repo_path", "timestamp", "source", "input_tokens", "output_tokens", "cached_input_tokens", "cost_usd", "model", "cost_source", "cache_write_input_tokens", "reasoning_output_tokens", "session_id") SELECT `u`.`id`, `u`.`contact_id`, `c`.`persona_template_id`, `c`.`repo_path`, `u`.`timestamp`, `u`.`source`, `u`.`input_tokens`, `u`.`output_tokens`, `u`.`cached_input_tokens`, `u`.`cost_usd`, `u`.`model`, `u`.`cost_source`, `u`.`cache_write_input_tokens`, `u`.`reasoning_output_tokens`, `u`.`session_id` FROM `usage_events` `u` LEFT JOIN `contacts` `c` ON `c`.`id` = `u`.`contact_id`;--> statement-breakpoint
DROP TABLE `usage_events`;--> statement-breakpoint
ALTER TABLE `__new_usage_events` RENAME TO `usage_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `usage_events_contact_timestamp_idx` ON `usage_events` (`contact_id`,`timestamp`);
