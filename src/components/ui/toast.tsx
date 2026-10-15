import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ToastInput {
  title: string
  description?: string
  variant?: 'default' | 'destructive'
}

interface ToastItem extends ToastInput {
  id: number
}

const MAX_VISIBLE = 4
const AUTO_DISMISS_MS = 6000

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ToastItem[] {
  return items
}

/** Tampilkan notifikasi toast (otomatis hilang setelah beberapa detik). */
export function toast(input: ToastInput) {
  const id = nextId++
  items = [...items, { ...input, id }].slice(-MAX_VISIBLE)
  emit()
  window.setTimeout(() => dismissToast(id), AUTO_DISMISS_MS)
}

export function dismissToast(id: number) {
  if (!items.some((t) => t.id === id)) return
  items = items.filter((t) => t.id !== id)
  emit()
}

/** Container toast global — dipasang sekali di App, dirender via portal. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'pointer-events-auto flex animate-toast-in items-start gap-3 rounded-lg border p-3 shadow-lg',
            t.variant === 'destructive'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-border bg-popover text-popover-foreground',
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium break-words">{t.title}</p>
            {t.description && (
              <p
                className={cn(
                  'mt-0.5 text-xs break-words whitespace-pre-wrap',
                  t.variant === 'destructive'
                    ? 'text-destructive/80'
                    : 'text-muted-foreground',
                )}
              >
                {t.description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Tutup notifikasi"
            onClick={() => dismissToast(t.id)}
            className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-accent/60"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
