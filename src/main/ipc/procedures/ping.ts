import { registerProcedure } from '../registerProcedure'

registerProcedure('ping', () => ({
  message: 'pong',
  timestamp: Date.now()
}))
