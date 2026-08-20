import type * as MonacoModule from 'monaco-editor'

/**
 * One lazy Monaco per window.
 *
 * Loaded on first use rather than at startup — Monaco is megabytes, and the
 * chats screen must not pay for a diff nobody has opened. The worker is
 * inlined because the packaged renderer loads over file://, where a chunk URL
 * worker is at the mercy of Chromium's file-origin rules; inlining sidesteps
 * the question entirely.
 *
 * Every label gets the plain editor worker. The language-service workers
 * (typescript, json, css, html) are deliberately not shipped: they exist for
 * diagnostics and IntelliSense, and a read-only diff wants neither — red
 * squiggles about unresolvable imports in a single-file model are noise
 * dressed as errors. Diagnostics are switched off below so the services never
 * ask for their worker in the first place.
 */

let loading: Promise<typeof MonacoModule> | null = null

export function loadMonaco(): Promise<typeof MonacoModule> {
  loading ??= load()
  return loading
}

async function load(): Promise<typeof MonacoModule> {
  // Both imports are dynamic so neither the editor nor the worker's inlined
  // base64 weighs on the startup bundle — the chats screen must not pay for a
  // diff nobody has opened.
  const [{ default: editorWorker }, monaco] = await Promise.all([
    import('monaco-editor/editor/editor.worker.js?worker&inline'),
    import('monaco-editor')
  ])
  self.MonacoEnvironment = { getWorker: () => new editorWorker() }

  // Every worker-backed provider off, not just diagnostics: any one of them
  // left on would lazily spawn the language-service worker this bundle does
  // not carry. Monarch colorization is main-thread and untouched by this.
  const off = {
    completionItems: false,
    hovers: false,
    documentSymbols: false,
    definitions: false,
    references: false,
    documentHighlights: false,
    rename: false,
    diagnostics: false,
    documentRangeFormattingEdits: false,
    signatureHelp: false,
    onTypeFormattingEdits: false,
    codeActions: false,
    inlayHints: false
  }
  monaco.typescript.typescriptDefaults.setModeConfiguration(off)
  monaco.typescript.javascriptDefaults.setModeConfiguration(off)
  monaco.json.jsonDefaults.setModeConfiguration({ ...off, tokens: false })
  for (const defaults of [
    monaco.css.cssDefaults,
    monaco.css.scssDefaults,
    monaco.css.lessDefaults
  ]) {
    defaults.setModeConfiguration({
      ...off,
      colors: false,
      foldingRanges: false,
      selectionRanges: false
    })
  }
  monaco.html.htmlDefaults.setModeConfiguration({ ...off })

  monaco.editor.setTheme(currentMonacoTheme())
  watchThemeClass(monaco)
  return monaco
}

export function currentMonacoTheme(): string {
  return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs'
}

/**
 * setTheme is global across every standalone editor, so one observer serves
 * all panes. Watching the class rather than the store keeps this file free of
 * React — it follows whatever useThemeSync stamps, system flips included.
 */
function watchThemeClass(monaco: typeof MonacoModule): void {
  const observer = new MutationObserver(() => monaco.editor.setTheme(currentMonacoTheme()))
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}
