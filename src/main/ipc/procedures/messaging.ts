import { registerProcedure } from '../registerProcedure'
import { modelsForBackend } from '../../adapters/models'
import {
  cancelRun,
  listActiveRuns,
  listMessages,
  messagePreviews,
  sendMessage
} from '../../services/messaging'
import { listUsageEvents } from '../../services/usage-events'

registerProcedure('messages.list', ({ contactId }) => listMessages(contactId))
registerProcedure('messages.previews', () => messagePreviews())
registerProcedure('messages.send', ({ contactId, content }) => sendMessage(contactId, content))
registerProcedure('messages.cancel', ({ runId }) => ({ cancelled: cancelRun(runId) }))

registerProcedure('runs.list', () => listActiveRuns())
registerProcedure('usage.list', ({ contactId }) => listUsageEvents(contactId))
registerProcedure('models.listForBackend', ({ backend }) => modelsForBackend(backend))
