import { registerProcedure } from '../registerProcedure'
import { applyStarterSelection, starterCatalog } from '../../services/seed'

registerProcedure('seed.catalog', () => starterCatalog())

registerProcedure('seed.applySelection', ({ personaIds, skillIds }) =>
  applyStarterSelection(personaIds, skillIds)
)
