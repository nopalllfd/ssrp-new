import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

export function DialogContent({
  children,
  className,
  title,
  onClose,
}: {
  children: ReactNode
  className?: string
  title?: string
  onClose?: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        // max-h-full mengacu ke content box parent (viewport - p-4) sehingga
        // modal tidak pernah lebih tinggi dari viewport dan tidak terpotong.
        'flex max-h-full w-full max-w-lg flex-col rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl',
        className,
      )}
    >
      <div className="mb-4 flex shrink-0 items-center justify-between">
        {title ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
