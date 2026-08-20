import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'

/**
 * Saving an export to disk.
 *
 * A mutation rather than a bare call so a failed write reports itself. The
 * cancel case is deliberately silent: `files.saveText` answers a cancelled
 * dialog with a null path, and a toast saying "nothing was saved" after
 * somebody pressed Escape is the app talking about itself.
 *
 * The success toast names the file rather than the full path — the path is
 * usually longer than the toast — and the user just chose the folder, so where
 * it went is the one part they already know.
 */
export function useSaveExport(): {
  save: (input: {
    suggestedName: string
    content: string
    filters?: { name: string; extensions: string[] }[]
  }) => void
  isPending: boolean
} {
  const mutation = useMutation({
    mutationFn: (input: {
      suggestedName: string
      content: string
      filters?: { name: string; extensions: string[] }[]
    }) => callProcedure('files.saveText', input),
    onSuccess: ({ path }) => {
      if (path === null) return
      toast.success(`Saved ${path.split('/').pop()}`)
    },
    onError: (error) => toast.error(ipcErrorMessage(error))
  })

  return { save: (input) => mutation.mutate(input), isPending: mutation.isPending }
}
