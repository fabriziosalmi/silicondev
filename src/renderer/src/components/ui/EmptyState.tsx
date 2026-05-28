import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-12 h-12 rounded-xl bg-hover flex items-center justify-center text-foreground-subtle mb-4">
        {icon}
      </div>
      <h3 className="text-sm font-medium text-foreground-muted mb-1">{title}</h3>
      {description && <p className="text-xs text-foreground-subtle text-center max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
