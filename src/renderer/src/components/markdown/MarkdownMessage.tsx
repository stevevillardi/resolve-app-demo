import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'
import { cn } from '@/lib/utils'

interface MarkdownMessageProps {
  content: string
  className?: string
}

const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? '')
    const isBlock = Boolean(match)
    const text = String(children).replace(/\n$/, '')

    if (!isBlock) {
      return (
        <code className="bg-muted rounded px-1 py-0.5 text-[0.85em]" {...props}>
          {children}
        </code>
      )
    }

    return <CodeBlock code={text} language={match?.[1]} className="my-2" />
  }
}

export function MarkdownMessage({ content, className }: MarkdownMessageProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'max-w-none text-sm leading-relaxed',
        '[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-base [&_h1]:font-semibold',
        '[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-base [&_h2]:font-semibold',
        '[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold',
        '[&_p]:my-1.5 [&_p]:first:mt-0 [&_p]:last:mb-0',
        '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5',
        '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_li]:my-0.5',
        '[&_strong]:font-semibold',
        '[&_a]:underline [&_a]:underline-offset-2',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
