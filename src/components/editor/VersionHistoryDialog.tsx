import { useState } from 'react'
import { History, RotateCcw, Save } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEditorStore } from '@/store/editor'
import {
  getVersionSnapshot,
  listVersions,
  logActivity,
  type ProjectVersionRow,
} from '@/lib/api'
import { parseDocument } from '@/lib/editorDocument'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge, Label, Skeleton } from '@/components/ui/misc'
import { formatDateTime } from '@/lib/utils'

/**
 * Version history: manual snapshots on demand + automatic snapshots created
 * by the persistence hook. Restoring writes the snapshot into the editor as
 * a normal mutation so it stays undoable and autosaves to a new revision.
 */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  projectId,
  onSaveManualSnapshot,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  onSaveManualSnapshot: (name: string) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const mutate = useEditorStore((s) => s.mutate)
  const canUndoDirty = useEditorStore((s) => s.dirty)

  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ProjectVersionRow | null>(null)

  const versionsQuery = useQuery({
    queryKey: ['versions', projectId],
    queryFn: () => listVersions(projectId),
    enabled: open,
  })

  const createSnapshot = async () => {
    setBusy('snapshot')
    setError(null)
    try {
      await onSaveManualSnapshot(name.trim() || 'Manual snapshot')
      setName('')
      await queryClient.invalidateQueries({ queryKey: ['versions', projectId] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create snapshot')
    } finally {
      setBusy(null)
    }
  }

  const restore = async (row: ProjectVersionRow) => {
    setBusy(row.id)
    setError(null)
    try {
      const raw = await getVersionSnapshot(row.id)
      const parsed = parseDocument(raw)
      if (!parsed.ok) throw new Error(`Snapshot tidak valid: ${parsed.error}`)
      const snapshot = parsed.document
      mutate((doc) => {
        doc.canvas = structuredClone(snapshot.canvas)
        doc.layers = structuredClone(snapshot.layers)
        doc.assets = structuredClone(snapshot.assets)
        doc.sharedCrop = structuredClone(snapshot.sharedCrop)
        doc.applySameCropToAll = snapshot.applySameCropToAll
      })
      void logActivity({
        projectId,
        action: 'version.restore',
        metadata: { version: row.version_number },
      })
      setConfirm(null)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to restore version')
    } finally {
      setBusy(null)
    }
  }

  const versions = versionsQuery.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Version history"
        onClose={() => onOpenChange(false)}
        className="max-w-2xl"
      >
        <div className="mb-4 rounded-md border border-border p-3">
          <Label>Create a named snapshot</Label>
          <div className="mt-2 flex items-center gap-2">
            <Input
              placeholder='e.g. "Sebelum ganti background"'
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createSnapshot()
              }}
            />
            <Button onClick={() => void createSnapshot()} disabled={busy === 'snapshot'}>
              <Save /> {busy === 'snapshot' ? 'Saving…' : 'Snapshot'}
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Snapshot otomatis dibuat tiap 5 menit saat ada perubahan (maks. 10 disimpan).
            {canUndoDirty ? ' Perubahan yang belum tersimpan ikut disimpan dulu.' : ''}
          </p>
        </div>

        {error && (
          <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {versionsQuery.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : versions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No versions yet. Create your first snapshot above.
          </p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
            {versions.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-3 rounded-md border border-border p-3"
              >
                <History className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    v{v.version_number} — {v.name ?? (v.kind === 'automatic' ? 'Auto snapshot' : 'Manual snapshot')}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatDateTime(v.created_at)}
                  </p>
                </div>
                <Badge>{v.kind}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === v.id}
                  onClick={() => setConfirm(v)}
                >
                  <RotateCcw /> {busy === v.id ? 'Restoring…' : 'Restore'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {confirm && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold">
                Restore v{confirm.version_number}?
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Canvas saat ini diganti dengan isi snapshot ini. Restore menjadi aksi
                edit biasa — masih bisa di-undo.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void restore(confirm)}>
                  Restore
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
