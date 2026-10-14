import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import logoUrl from '@/assets/logo.svg'

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, ...props }, ref) {
    return (
      <label
        ref={ref}
        className={cn('text-xs font-medium text-muted-foreground', className)}
        {...props}
      />
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'flex h-9 w-full cursor-pointer rounded-md border border-input bg-card px-2 text-sm text-card-foreground',
          'focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
          // Opsi native perlu latar eksplisit supaya dropdown kontras di tema gelap.
          '[&>option]:bg-card [&>option]:text-card-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm',
          'placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring',
          className,
        )}
        {...props}
      />
    )
  },
)

export function Slider({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="range"
      className={cn('h-1.5 w-full cursor-pointer accent-white', className)}
      {...props}
    />
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

/** Layar loading penuh bermerek: logo bernapas + bar progres indeterminate. */
export function LoadingScreen({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div
      className="flex h-full min-h-screen flex-col items-center justify-center gap-4"
      role="status"
      aria-live="polite"
    >
      <img
        src={logoUrl}
        alt="Logo Yurchat"
        className="size-16 animate-logo-breathe rounded-2xl"
      />
      <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-loading-slide rounded-full bg-primary" />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <span
        className={cn(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-4 rounded-full bg-background transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
      {label}
    </button>
  )
}
