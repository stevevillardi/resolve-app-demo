import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { callProcedure } from './lib/ipc-client'
import { useUiStore } from './store/useUiStore'

function App(): React.JSX.Element {
  // Proves the Zustand store is wired end to end; real usage starts in Phase 2.
  const activeContactId = useUiStore((state) => state.activeContactId)

  const pingMutation = useMutation({
    mutationFn: () => callProcedure('ping', undefined)
  })

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <Button onClick={() => pingMutation.mutate()} disabled={pingMutation.isPending}>
        {pingMutation.isPending ? 'Pinging main process…' : 'Ping main process'}
      </Button>
      {pingMutation.data && (
        <p className="text-muted-foreground text-sm">
          {pingMutation.data.message} at{' '}
          {new Date(pingMutation.data.timestamp).toLocaleTimeString()}
        </p>
      )}
      {pingMutation.isError && (
        <p className="text-destructive text-sm">{String(pingMutation.error)}</p>
      )}
      <p className="text-muted-foreground text-xs">
        Active contact (Zustand): {activeContactId ?? 'none'}
      </p>
    </div>
  )
}

export default App
