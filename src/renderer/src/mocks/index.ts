/**
 * What is left of the Phase 2 fixtures.
 *
 * Phase 6 removed the four that had become dead: `messages` and
 * `markdownSamples` (ThreadView reads real rows now), `repos` (NewContactFlow
 * lists real GitHub repos and real folders), and `skills` (already unused since
 * Phase 4). Phase 7 removed `groups` — GroupThreadView and ConversationList
 * both read real `group_messages` rows now.
 *
 * These four survive because the screens that read them are still ahead: the
 * routine screens are Phase 8 and the usage dashboard is Phase 10. Their ids
 * match the first-run seed in src/main/db/seed-data.ts, so those screens join
 * against real personas rather than rendering orphans.
 */
export * from './personaTemplates'
export * from './contacts'
export * from './routines'
export * from './usageEvents'
