import { writeFile } from 'fs/promises'
import { dialog } from 'electron'

/**
 * Saving something the user asked for to somewhere the user chose (review §G2).
 *
 * The app's first write outside its own profile directory, so the posture is
 * worth stating. Everything else that touches a path is allowlisted:
 * `shell.openPath` runs `isKnownLocalPath()` first, deliberately, so that it
 * never becomes "open whatever the renderer names". This does not, and the
 * difference is `showSaveDialog` — the destination is not supplied by the
 * caller at all. The renderer proposes a *filename*; a person chooses the
 * directory in an OS dialog and can decline. That dialog is the authorization,
 * and an allowlist on top of it would only mean refusing to save where the user
 * just said to.
 *
 * `null` means cancelled, which is an ordinary outcome rather than a failure —
 * the caller shows nothing.
 */
export async function saveTextFile(input: {
  suggestedName: string
  content: string
  /** Shown in the dialog's file-type popup, e.g. `[{ name: 'Markdown', extensions: ['md'] }]`. */
  filters?: { name: string; extensions: string[] }[]
}): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    defaultPath: input.suggestedName,
    ...(input.filters ? { filters: input.filters } : {}),
    // Without this, macOS silently drops an extension the user did not type,
    // and the file opens in the wrong application.
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })

  if (result.canceled || !result.filePath) return null

  await writeFile(result.filePath, input.content, 'utf8')
  return result.filePath
}
