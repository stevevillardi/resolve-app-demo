-- Three indexes for reads that were already being done, on tables that were
-- already being scanned. Pure `CREATE INDEX` — no column moves,
-- no data changes, nothing to backfill, and nothing an older build would
-- misread if a profile were opened by one.
--
-- `contacts_persona_template_idx` covers "which contacts use this persona".
-- That question has three askers: the persona detail panel's bound-contacts
-- list, the usage rail's per-persona rollup, and the RESTRICT gate that refuses
-- to delete a persona still in use (schema.ts, `persona_template_id`). The
-- column has been a foreign key since 0002 and SQLite does not index the
-- referencing side for you, so all three were full scans.
--
-- The other two are the columns migration 0008 denormalised onto `usage_events`
-- for one stated purpose — so spend outlives the Contact that spent it and can
-- still be grouped by persona and by repo afterwards — and which every grouping
-- read then scanned the whole table to use.
--
-- Paired with `timestamp` rather than indexed alone, because no caller wants
-- one without the other: every usage read is inside a range (7 days, 30 days,
-- all), so the pair lets SQLite satisfy the filter and the ordering from the
-- index without visiting rows it is going to discard. This mirrors
-- `usage_events_contact_timestamp_idx`, which is the same shape for the third
-- axis, and it is why these are not three single-column indexes.
CREATE INDEX `contacts_persona_template_idx` ON `contacts` (`persona_template_id`);--> statement-breakpoint
CREATE INDEX `usage_events_repo_timestamp_idx` ON `usage_events` (`repo_path`,`timestamp`);--> statement-breakpoint
CREATE INDEX `usage_events_persona_timestamp_idx` ON `usage_events` (`persona_template_id`,`timestamp`);