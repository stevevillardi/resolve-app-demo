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
    if (!match) {
      return (
        <code
          className="bg-foreground/8 rounded px-1 py-0.5 font-mono text-[0.85em] break-words"
          {...props}
        >
          {children}
        </code>
      )
    }
    return <CodeBlock code={String(children).replace(/\n$/, '')} language={match[1]} />
  },
  // remark-gfm produces tables; react-markdown renders them as bare <table>.
  // They need their own scroll container or a wide table blows out the bubble.
  table({ children }) {
    return (
      <div className="scrollbar-subtle border-border my-2 overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    )
  }
}

/**
 * `@tailwindcss/typography` isn't a dependency, so `prose` classes would be
 * inert — every element is styled explicitly below. Kept as arbitrary variants
 * rather than a stylesheet so it stays scoped to rendered markdown and can't
 * leak into the surrounding bubble.
 */
export function MarkdownMessage({ content, className }: MarkdownMessageProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'max-w-none text-sm leading-relaxed',
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        '[&_h1]:mt-4 [&_h1]:mb-1.5 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:tracking-tight',
        '[&_h2]:mt-4 [&_h2]:mb-1.5 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:tracking-tight',
        '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-[13px] [&_h3]:font-semibold',
        '[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:opacity-80',
        '[&_h5]:mt-2 [&_h5]:mb-1 [&_h5]:text-xs [&_h5]:font-semibold [&_h5]:opacity-80',
        '[&_h6]:mt-2 [&_h6]:mb-1 [&_h6]:text-xs [&_h6]:font-semibold [&_h6]:opacity-70',
        '[&_p]:my-2',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
        '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_li]:my-1 [&_li]:pl-0.5 [&_li>p]:my-0',
        '[&_strong]:font-semibold',
        '[&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-current/40 hover:[&_a]:decoration-current',
        '[&_hr]:border-current/15 [&_hr]:my-4',
        // Quoted material gets a rule and a hang, not a tinted box — this is
        // the one place a left border earns its keep, because it is the
        // conventional typographic mark for a quotation.
        '[&_blockquote]:border-current/25 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:opacity-80',
        '[&_th]:border-border [&_th]:bg-foreground/4 [&_th]:border-b [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold',
        '[&_td]:border-border/70 [&_td]:border-b [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top',
        '[&_tr:last-child_td]:border-b-0',
        '[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
