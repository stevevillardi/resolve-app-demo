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

No blockers otherwise — approving once the timing-safe compare is in.`

export const REFACTOR_STREAMING_MARKDOWN = `Renaming \`fetchStuff\` → \`fetchWorkspaceIssues\` across the repo and updating call`
