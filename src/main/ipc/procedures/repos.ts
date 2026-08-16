import { registerProcedure } from '../registerProcedure'
import { chooseDirectory, cloneToWorkspace, listRepos } from '../../services/repos'

registerProcedure('repos.list', () => listRepos())
registerProcedure('repos.chooseDirectory', () => chooseDirectory())
registerProcedure('repos.clone', ({ fullName, cloneUrl }) => cloneToWorkspace(fullName, cloneUrl))
