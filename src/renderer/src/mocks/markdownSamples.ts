export const CODE_REVIEW_MARKDOWN = `## Review: \`auth.ts\`

Looked through the changes — mostly solid. A couple of things before this ships:

- Token comparison uses \`===\` on a raw string. Switch to a constant-time compare.
- The new \`refreshSession\` path doesn't invalidate the old session id.
- Nice catch adding the expiry check on line 42.

**Suggested fix:**

\`\`\`ts
import { timingSafeEqual } from 'node:crypto'

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
\`\`\`

### Severity

| Finding | File | Severity |
| --- | --- | --- |
| Non-constant-time token compare | \`auth.ts:31\` | High |
| Stale session id after refresh | \`auth.ts:58\` | Medium |
| Missing test for expired token | \`auth.test.ts\` | Low |

> Worth noting: the expiry check only covers access tokens. Refresh tokens
> still rely on the store's TTL, which is set in a different module.

No blockers otherwise — approving once the timing-safe compare is in.`

export const REFACTOR_STREAMING_MARKDOWN = `Renaming \`fetchStuff\` → \`fetchWorkspaceIssues\` across the repo and updating call`
