import { initDb } from '../db'
import { appState, personaTemplates, skills } from '../db/schema'
import { SEED_PERSONA_TEMPLATES, SEED_SKILLS } from '../db/seed-data'
import { getAppState } from './app-state'

/**
 * The seed the current build would apply. Bumping this is how a future release
 * adds new defaults; the check below would then need to become a comparison
 * rather than a presence test, and to only insert what's new.
 */
const SEED_VERSION = '1'

/**
 * Inserts the first-run skills and persona templates, once ever.
 *
 * Guarded on the `seed_version` marker rather than on the tables being empty.
 * That distinction is the whole point: a user who deletes every seeded skill
 * has made a decision, and an emptiness check would silently undo it on the
 * next launch. The marker records that seeding *happened*, not what survived.
 *
 * Safe to call on every startup. Runs in one transaction, and the marker is
 * written inside it, so a crash mid-seed leaves the database untouched and
 * unmarked rather than half-populated and marked done.
 */
export function seedIfNeeded(): void {
  if (getAppState('seed_version') !== null) return

  initDb().transaction((tx) => {
    // onConflictDoNothing so a stable seed id that somehow already exists (a
    // hand-restored database, a partially migrated profile) is left alone
    // rather than aborting the whole transaction.
    for (const skill of SEED_SKILLS) {
      tx.insert(skills).values(skill).onConflictDoNothing().run()
    }
    for (const persona of SEED_PERSONA_TEMPLATES) {
      tx.insert(personaTemplates).values(persona).onConflictDoNothing().run()
    }
    // Written through `tx`, not setAppState(). better-sqlite3 transactions run
    // on the same connection so either would land inside the transaction, but
    // relying on that is the kind of thing that quietly stops being true.
    tx.insert(appState)
      .values({ key: 'seed_version', value: SEED_VERSION })
      .onConflictDoUpdate({ target: appState.key, set: { value: SEED_VERSION } })
      .run()
  })
}
