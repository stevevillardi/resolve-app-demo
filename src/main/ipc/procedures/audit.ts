import { registerProcedure } from '../registerProcedure'
import { listAuditEvents } from '../../services/audit-events'

registerProcedure('audit.list', () => listAuditEvents())
