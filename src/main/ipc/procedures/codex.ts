import { registerProcedure } from '../registerProcedure'
import { cancelCodexLogin, getCodexLoginState, startCodexLogin } from '../../services/codex-auth'

registerProcedure('codex.startLogin', () => startCodexLogin())
registerProcedure('codex.getLoginState', () => getCodexLoginState())
registerProcedure('codex.cancelLogin', () => cancelCodexLogin())
