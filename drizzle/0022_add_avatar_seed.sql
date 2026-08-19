-- The robot was derived from the immutable persona id; this makes it a choice.
-- Nullable with no backfill: null means "seed = the persona's id", which is
-- exactly what every existing row rendered before this column existed, so an
-- upgrade changes nobody's robot (same posture as mcp_server_ids / groups.name).
ALTER TABLE `persona_templates` ADD `avatar_seed` text;
