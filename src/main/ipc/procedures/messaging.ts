import { registerProcedure } from '../registerProcedure'
import { modelsForBackend } from '../../adapters/models'
import {
  cancelRun,
  listActiveRuns,
  listMessages,
  listToolCalls,
  mentionInGroup,
  messagePreviews,
  sendMessage
} from '../../services/messaging'
import {
  groupForRepo,
  groupMessagePreviews,
  listGroupMessages
} from '../../services/group-messages'
import { listUsageEvents } from '../../services/usage-events'

registerProcedure('messages.list', ({ contactId }) => listMessages(contactId))
registerProcedure('messages.toolCalls', ({ contactId }) => listToolCalls(contactId))
registerProcedure('messages.previews', () => messagePreviews())
registerProcedure('messages.send', ({ contactId, content }) => sendMessage(contactId, content))
registerProcedure('messages.cancel', ({ runId }) => ({ cancelled: cancelRun(runId) }))

registerProcedure('groupMessages.list', ({ groupId }) => listGroupMessages(groupId))
registerProcedure('groupMessages.previews', () => groupMessagePreviews())
registerProcedure('groups.getForRepo', ({ repoPath }) => groupForRepo(repoPath))
registerProcedure('groups.mention', ({ groupId, contactId, content }) =>
  mentionInGroup(groupId, contactId, content)
)

registerProcedure('runs.list', () => listActiveRuns())
registerProcedure('usage.list', ({ contactId }) => listUsageEvents(contactId))
registerProcedure('models.listForBackend', ({ backend }) => modelsForBackend(backend))
