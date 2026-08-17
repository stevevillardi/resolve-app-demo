-- Full-text search over both message tables (review §B4).
--
-- External-content FTS5: the index stores no second copy of the text (the
-- content= table is the source of truth) while snippet() keeps working —
-- a contentless table cannot produce snippets, and a plain shadow table
-- doubles storage for nothing. unicode61 rather than porter: message text
-- here is full of code identifiers, and stemming makes `worktrees` match
-- `worktree` at the cost of making `caching` match `cache` in a filename —
-- exact tokens are the right trade for a developer tool.
--
-- Kept in sync by triggers rather than at the insertMessage/insertGroupMessage
-- chokepoints, because one write path never goes through them: deleting a
-- contact cascades its messages away inside SQLite. The UPDATE triggers are
-- defensive — nothing updates content today, but message editing is deferred,
-- not dead, and a missed UPDATE trigger is silent index corruption.
CREATE VIRTUAL TABLE `messages_fts` USING fts5(`content`, content=`messages`, content_rowid=`rowid`, tokenize='unicode61 remove_diacritics 2');--> statement-breakpoint
CREATE VIRTUAL TABLE `group_messages_fts` USING fts5(`content`, content=`group_messages`, content_rowid=`rowid`, tokenize='unicode61 remove_diacritics 2');--> statement-breakpoint
CREATE TRIGGER `messages_fts_after_insert` AFTER INSERT ON `messages` BEGIN
  INSERT INTO `messages_fts`(rowid, content) VALUES (new.rowid, new.content);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_after_delete` AFTER DELETE ON `messages` BEGIN
  INSERT INTO `messages_fts`(`messages_fts`, rowid, content) VALUES ('delete', old.rowid, old.content);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_after_update` AFTER UPDATE OF `content` ON `messages` BEGIN
  INSERT INTO `messages_fts`(`messages_fts`, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO `messages_fts`(rowid, content) VALUES (new.rowid, new.content);
END;--> statement-breakpoint
CREATE TRIGGER `group_messages_fts_after_insert` AFTER INSERT ON `group_messages` BEGIN
  INSERT INTO `group_messages_fts`(rowid, content) VALUES (new.rowid, new.content);
END;--> statement-breakpoint
CREATE TRIGGER `group_messages_fts_after_delete` AFTER DELETE ON `group_messages` BEGIN
  INSERT INTO `group_messages_fts`(`group_messages_fts`, rowid, content) VALUES ('delete', old.rowid, old.content);
END;--> statement-breakpoint
CREATE TRIGGER `group_messages_fts_after_update` AFTER UPDATE OF `content` ON `group_messages` BEGIN
  INSERT INTO `group_messages_fts`(`group_messages_fts`, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO `group_messages_fts`(rowid, content) VALUES (new.rowid, new.content);
END;--> statement-breakpoint
-- Backfill: an upgrade lands with its history already searchable. Runs inside
-- the migrator's single transaction; at this app's scale that is milliseconds.
INSERT INTO `messages_fts`(rowid, content) SELECT rowid, content FROM `messages`;--> statement-breakpoint
INSERT INTO `group_messages_fts`(rowid, content) SELECT rowid, content FROM `group_messages`;
