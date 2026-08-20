import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { createHighlighter, type Highlighter } from 'shiki'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CodeBlockProps {
  code: string
  language?: string
  className?: string
}

const THEMES = { light: 'github-light', dark: 'github-dark' } as const

// A single highlighter, created once and shared. Calling codeToHtml() per
// mount re-instantiates the WASM engine and the grammar for each block — fine
// for one fixture, ruinous when a streaming reply emits a code fence token by
// token.
let highlighterPromise: Promise<Highlighter> | null = null
const loadedLanguages = new Set<string>(['text'])

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEMES.light, THEMES.dark],
      langs: ['text']
    })
  }
  return highlighterPromise
}

async function highlight(code: string, language: string): Promise<string> {
  const highlighter = await getHighlighter()
  let lang = language
  if (!loadedLanguages.has(lang)) {
    try {
      await highlighter.loadLanguage(lang as Parameters<Highlighter['loadLanguage']>[0])
      loadedLanguages.add(lang)
    } catch {
      // Agents emit fences with all sorts of tags; an unknown one renders as
      // plain text rather than losing the block.
      lang = 'text'
    }
  }
  return highlighter.codeToHtml(code, {
    lang,
    themes: THEMES,
    // Emits `color:` for light and a --shiki-dark custom property for dark.
    // assets/main.css has the rule that consumes it — without that rule, dark
    // mode silently renders light-theme colours.
    defaultColor: false
  })
}

export function CodeBlock({
  code,
  language = 'text',
  className
}: CodeBlockProps): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    highlight(code, language)
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  const onCopy = (): void => {
    void navigator.clipboard.writeText(code).then(() => setCopied(true))
  }

  return (
    <div
      className={cn(
        'border-border bg-background group/code my-2 overflow-hidden rounded-lg border',
        className
      )}
    >
      <div className="border-border bg-muted/40 flex h-7 items-center justify-between border-b pr-1 pl-2.5">
        <span className="text-muted-foreground font-mono text-micro tracking-wide uppercase">
          {language}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
      </div>
      {html ? (
        <div
          className="scrollbar-subtle [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-code [&_pre]:leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="scrollbar-subtle overflow-x-auto p-3 font-mono text-code leading-relaxed">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
