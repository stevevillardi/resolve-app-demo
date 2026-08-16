import { registerProcedure } from '../registerProcedure'
import {
  cancelDeviceFlow,
  disconnectGitHub,
  getDeviceFlowState,
  startDeviceFlow
} from '../../services/github-auth'

registerProcedure('github.startDeviceFlow', () => startDeviceFlow())
registerProcedure('github.getDeviceFlowState', () => getDeviceFlowState())
registerProcedure('github.cancelDeviceFlow', () => cancelDeviceFlow())
registerProcedure('github.disconnect', () => disconnectGitHub())
