import { useEffect, useState } from 'react'
import { codeToHtml } from 'shiki'
import { cn } from '@/lib/utils'

interface CodeBlockProps {
  code: string
  language?: string
  className?: string
}

export function CodeBlock({
  code,
  language = 'text',
  className
}: CodeBlockProps): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    codeToHtml(code, {
      lang: language,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false
    })
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

  if (html) {
    return (
      <div
        className={cn(
          '[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-sm',
          className
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <pre className={cn('bg-muted overflow-x-auto rounded-lg p-3 text-sm', className)}>
      <code>{code}</code>
    </pre>
  )
}
