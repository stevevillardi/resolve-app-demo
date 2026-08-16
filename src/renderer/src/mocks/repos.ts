export interface MockRepo {
  id: string
  fullName: string
  clonedLocally: boolean
}

export const mockRepos: MockRepo[] = [
  { id: 'repo-1', fullName: 'stevevillardi/persona-router', clonedLocally: true },
  { id: 'repo-2', fullName: 'stevevillardi/marketing-site', clonedLocally: true },
  { id: 'repo-3', fullName: 'stevevillardi/infra-scripts', clonedLocally: false },
  { id: 'repo-4', fullName: 'acme-co/design-tokens', clonedLocally: false }
]
