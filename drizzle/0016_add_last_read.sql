ALTER TABLE `contacts` ADD `last_read_at` integer;--> statement-breakpoint
ALTER TABLE `groups` ADD `last_read_at` integer;--> statement-breakpoint
-- Backfill to the migration's own run time: an upgrade must land with zero
-- badges, not a wall of stale ones claiming months of history is unread.
UPDATE `contacts` SET `last_read_at` = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE `last_read_at` IS NULL;--> statement-breakpoint
UPDATE `groups` SET `last_read_at` = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE `last_read_at` IS NULL;
