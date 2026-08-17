-- Data fix for Phase 17's scope rule: `sandbox: full_access` bypasses both
-- GitHub-scope enforcement points (the MCP tool filter and the shell guard are
-- off under bypassPermissions / danger-full-access), so a narrower githubScope
-- on a full_access persona was never enforceable — the write path now refuses
-- the combination, and this normalizes any rows that predate the rule so reads
-- and edits of them don't trip the same validation.
UPDATE persona_templates SET github_scope = 'full_access' WHERE sandbox = 'full_access';