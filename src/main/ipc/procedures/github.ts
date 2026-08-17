import { registerProcedure } from '../registerProcedure'
import {
  cancelDeviceFlow,
  disconnectGitHub,
  getDeviceFlowState,
  startDeviceFlow,
  verifyGitHubToken
} from '../../services/github-auth'
import { openPullRequest, pullRequestState } from '../../services/pull-requests'

registerProcedure('github.startDeviceFlow', () => startDeviceFlow())
registerProcedure('github.getDeviceFlowState', () => getDeviceFlowState())
registerProcedure('github.cancelDeviceFlow', () => cancelDeviceFlow())
registerProcedure('github.disconnect', () => disconnectGitHub())
registerProcedure('github.verify', () => verifyGitHubToken())

registerProcedure('github.pullRequestState', ({ contactId }) => pullRequestState(contactId))
registerProcedure('github.openPullRequest', ({ contactId }) => openPullRequest(contactId))
