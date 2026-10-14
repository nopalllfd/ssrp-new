import { LayoutTemplate } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'

/**
 * Dialog Templates — fitur dinonaktifkan sementara ("coming soon").
 * Aktifkan kembali implementasi save/apply template saat fitur siap diluncurkan.
 */
export function TemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Templates" onClose={() => onOpenChange(false)} className="max-w-md">
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex size-14 items-center justify-center rounded-full border border-border bg-accent/40">
            <LayoutTemplate className="size-7 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold">Coming soon</h3>
          <p className="max-w-xs text-xs text-muted-foreground">
            Fitur template sedang dikerjakan dan akan tersedia nanti.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
