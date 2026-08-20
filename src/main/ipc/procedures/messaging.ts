import { registerProcedure } from '../registerProcedure'
import { resolveApproval } from '../../services/approvals'
import { workDiff } from '../../services/diffs'
import { modelsForBackend } from '../../adapters/models'
import {
  cancelRun,
  listActiveRuns,
  listMessages,
  listToolCalls,
  mentionInGroup,
  messagePreviews,
  retryTurn,
  sendMessage
} from '../../services/messaging'
import {
  groupForRepo,
  groupMessagePreviews,
  listGroupMessages
} from '../../services/group-messages'
import { listUsageEvents, usageSummariesByContact } from '../../services/usage-events'

registerProcedure('messages.list', ({ contactId }) => listMessages(contactId))
registerProcedure('messages.toolCalls', ({ contactId }) => listToolCalls(contactId))
registerProcedure('messages.workDiff', ({ contactId, messageId }) => workDiff(contactId, messageId))
registerProcedure('messages.previews', () => messagePreviews())
registerProcedure('messages.send', ({ contactId, content }) => sendMessage(contactId, content))
registerProcedure('messages.cancel', ({ runId }) => ({ cancelled: cancelRun(runId) }))
registerProcedure('messages.retry', ({ contactId, groupId }) => retryTurn(contactId, groupId))

registerProcedure('groupMessages.list', ({ groupId }) => listGroupMessages(groupId))
registerProcedure('groupMessages.previews', () => groupMessagePreviews())
registerProcedure('groups.getForRepo', ({ repoPath }) => groupForRepo(repoPath))
registerProcedure('groups.mention', ({ groupId, contactId, content }) =>
  mentionInGroup(groupId, contactId, content)
)

registerProcedure('runs.list', () => listActiveRuns())
registerProcedure('runs.resolveApproval', ({ runId, approvalId, approved }) => ({
  resolved: resolveApproval(runId, approvalId, approved)
}))
registerProcedure('usage.list', ({ contactId }) => listUsageEvents(contactId))
registerProcedure('usage.summaries', () => usageSummariesByContact())
registerProcedure('models.listForBackend', ({ backend }) => modelsForBackend(backend))
