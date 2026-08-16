import { z } from 'zod'

/**
 * Single source of truth for main<->renderer IPC. Every procedure has an
 * input/output Zod schema, validated on both sides of the boundary by
 * registerProcedure() (main) and callProcedure() (renderer).
 *
 * Replaces electron-trpc, which was verified stale/incompatible with this
 * toolchain during Phase 1 planning — see docs/plan/00-progress.md.
 */
export const ipcContract = {
  ping: {
    input: z.void(),
    output: z.object({
      message: z.string(),
      timestamp: z.number()
    })
  }
} satisfies Record<string, { input: z.ZodType; output: z.ZodType }>

export type IpcContract = typeof ipcContract
export type IpcProcedureName = keyof IpcContract
export type IpcInput<K extends IpcProcedureName> = z.infer<IpcContract[K]['input']>
export type IpcOutput<K extends IpcProcedureName> = z.infer<IpcContract[K]['output']>
