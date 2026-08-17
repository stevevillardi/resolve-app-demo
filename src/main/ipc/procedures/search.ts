import { registerProcedure } from '../registerProcedure'
import { searchMessages } from '../../services/search'

registerProcedure('search.messages', ({ query, limit }) => searchMessages(query, limit))
