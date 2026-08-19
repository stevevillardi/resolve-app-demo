import { useEffect, useRef, useState } from 'react'
import { FileX2 } from 'lucide-react'
import { EmptyPane } from '@/components/common/EmptyPane'
import { languageForPath, noVisibleChangeNote, unrenderableReason } from '@/lib/diff-view'
import { loadMonaco } from '@/lib/monaco-host'
import type { FileDiff } from '../../../../shared/ipc-contract'
import type * as MonacoModule from 'monaco-editor'

type DiffEditor = ReturnType<(typeof MonacoModule)['editor']['createDiffEditor']>

/**
 * One file pair in Monaco's diff editor, read-only (Phase 19).
 *
 * The editor instance outlives file switches — models are swapped instead of
 * the widget being rebuilt, because standalone editor construction is the
 * expensive part. Everything interactive beyond scrolling and selecting is
 * switched off: this pane answers "what changed", it is not an editor that
 * happens to be locked.
 */
export function DiffPane({
  file,
  sideBySide
}: {
  file: FileDiff
  sideBySide: boolean
}): React.JSX.Element {
  const reason = unrenderableReason(file)
  if (reason) {
    return <EmptyPane icon={FileX2} title={file.path} description={reason} />
  }

  // Said above the editor, not instead of it. A renamed file's contents are
  // still worth reading, and replacing a mode change with a message would hide
  // the file to explain it — the direction unrenderableReason exists to avoid.
  const note = noVisibleChangeNote(file)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {note && (
        <p className="border-border text-muted-foreground shrink-0 border-b px-3 py-1.5 text-xs">
          {note}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <MonacoDiff file={file} sideBySide={sideBySide} />
      </div>
    </div>
  )
}

function MonacoDiff({
  file,
  sideBySide
}: {
  file: FileDiff
  sideBySide: boolean
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<DiffEditor | null>(null)
  const monacoRef = useRef<typeof MonacoModule | null>(null)
  /**
   * The load below is async; by the time it resolves the user may have picked
   * another file, and the mount closure's `file` would be stale. The ref is
   * what the resolution callback reads instead.
   *
   * Kept in step from an effect rather than assigned during render. A render
   * has to be free of side effects — React may discard one, or run it twice —
   * and a ref written there is a mutation that survives being thrown away.
   * Nothing is lost by moving it: `useRef(file)` already holds the right value
   * on mount, every later change runs this effect in the same commit, and the
   * only reader is a promise callback that cannot resolve before either.
   */
  const fileRef = useRef(file)
  useEffect(() => {
    fileRef.current = file
  }, [file])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false

    void loadMonaco()
      .then((monaco) => {
        if (disposed || !containerRef.current) return
        monacoRef.current = monaco
        editorRef.current = monaco.editor.createDiffEditor(containerRef.current, {
          readOnly: true,
          originalEditable: false,
          renderSideBySide: sideBySide,
          // The segmented control above this pane is the only thing that
          // decides the layout. Monaco otherwise drops to inline below 900px,
          // and the branch pane hands this editor roughly 800px on a normal
          // window (pane width less the 224px file rail) — so "Split" had been
          // rendering inline, with two adjacent line-number gutters, for every
          // window narrower than about 1900px. A control that silently does
          // the other thing is worse than one that is cramped.
          useInlineViewWhenSpaceIsLimited: false,
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderOverviewRuler: false,
          hideUnchangedRegions: { enabled: true },
          diffAlgorithm: 'advanced',
          // Monaco defaults this to true, which drops leading and trailing
          // whitespace edits entirely: git reports an insertion and a
          // deletion, the pane shows an unmarked file. A viewer for reviewing
          // what a persona committed cannot hide a change git reported.
          ignoreTrimWhitespace: false,
          contextmenu: false,
          // Hover and lightbulbs are what would wake the language services
          // whose workers are deliberately not shipped — see monaco-host.ts.
          hover: { enabled: 'off' },
          fontSize: 12,
          fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
          padding: { top: 8, bottom: 8 }
        })
        setPair(monaco, editorRef.current, fileRef.current)
      })
      .catch(() => setFailed(true))

    return () => {
      disposed = true
      const editor = editorRef.current
      const model = editor?.getModel()
      editor?.dispose()
      model?.original.dispose()
      model?.modified.dispose()
      editorRef.current = null
    }
    // Mount-only: file/side changes are handled by the effects below so the
    // widget survives them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    const previous = editor.getModel()
    setPair(monaco, editor, file)
    previous?.original.dispose()
    previous?.modified.dispose()
  }, [file])

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  if (failed) {
    return (
      <EmptyPane
        icon={FileX2}
        title="Diff viewer failed to load"
        description="The editor bundle could not be initialised. The file lists above are still accurate."
      />
    )
  }
  return <div ref={containerRef} className="h-full min-h-0 w-full" />
}

function setPair(monaco: typeof MonacoModule, editor: DiffEditor, file: FileDiff): void {
  const language = languageForPath(file.path)
  editor.setModel({
    original: monaco.editor.createModel(file.oldText ?? '', language),
    modified: monaco.editor.createModel(file.newText ?? '', language)
  })
}
