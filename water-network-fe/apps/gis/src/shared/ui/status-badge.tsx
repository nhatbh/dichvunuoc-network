import { Badge } from './shadcn/badge'
import { cn } from '@/shared/lib/utils'

/** Color treatments keyed by lowercased status. Unknown → slate. */
const STATUS_CLASS: Record<string, string> = {
  published: 'border-green-200 bg-green-50 text-green-700',
  passed: 'border-green-200 bg-green-50 text-green-700',
  draft: 'border-amber-200 bg-amber-50 text-amber-700',
  staging: 'border-slate-200 bg-slate-50 text-slate-700',
  retired: 'border-rose-200 bg-rose-50 text-rose-700',
}

const FALLBACK = 'border-slate-200 bg-slate-50 text-slate-700'

/** A status pill built on the shared Badge. Text + ring + bg — not color alone. */
export function StatusBadge(props: { status: string; class?: string }) {
  const treatment = () => STATUS_CLASS[props.status.toLowerCase()] ?? FALLBACK
  return (
    <Badge
      variant="outline"
      data-testid="status-badge"
      class={cn('capitalize', treatment(), props.class)}
    >
      {props.status}
    </Badge>
  )
}
