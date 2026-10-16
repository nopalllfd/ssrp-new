import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useAssets } from '@/hooks/useAssets'
import { resolveAssetUrl } from '@/lib/images'
import { deleteAssetBlob } from '@/db/local'
import { deleteAssetRecord } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AssetRef } from '@/types/editor'

/**
 * Horizontal filmstrip of the project's screenshots, pinned under the canvas.
 * Urutan mengikuti urutan import / urutan yang diatur user dengan seretan
 * (bukan diurutkan otomatis berdasarkan ukuran).
 */
export function FilmStrip({ projectId }: { projectId: string }) {
  const document = useEditorStore((s) => s.document)
  const activeAssetId = useEditorStore((s) => s.activeAssetId)
  const setActiveAsset = useEditorStore((s) => s.setActiveAsset)
  const mutate = useEditorStore((s) => s.mutate)
  const { importFiles, retryUpload } = useAssets(projectId)
  const [dragOver, setDragOver] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Filmstrip hanya menampilkan screenshot induk — aset milik layer overlay
  // (gambar tempelan) disembunyikan karena bukan screenshot tersendiri.
  const overlayAssetIds = new Set<string>()
  for (const l of document.layers) {
    if (l.type === 'image' && l.ownerAssetId) overlayAssetIds.add(l.assetId)
  }
  const orderedAssets = Object.values(document.assets).filter(
    (a) => !overlayAssetIds.has(a.id),
  )

  // Seret thumbnail ke thumbnail lain → sisipkan pada posisi itu.
  // Geser ke kanan: sisipkan sesudah target; geser ke kiri: sebelum target.
  const dropOn = (targetId: string) => {
    const fromId = dragId
    setDragId(null)
    if (!fromId || fromId === targetId) return
    mutate((doc) => {
      const overlays = new Set<string>()
      for (const l of doc.layers) {
        if (l.type === 'image' && l.ownerAssetId) overlays.add(l.assetId)
      }
      const ids = Object.keys(doc.assets).filter((id) => !overlays.has(id))
      const from = ids.indexOf(fromId)
      const to = ids.indexOf(targetId)
      if (from < 0 || to < 0 || from === to) return
      ids.splice(from, 1)
      ids.splice(to, 0, fromId)
      const rebuilt: typeof doc.assets = {}
      for (const id of ids) {
        const asset = doc.assets[id]
        if (asset) rebuilt[id] = asset
      }
      // Aset overlay tidak tampil di strip — sisipkan di belakang, urutannya
      // tidak berpengaruh ke mana pun.
      for (const [id, asset] of Object.entries(doc.assets)) {
        if (!(id in rebuilt)) rebuilt[id] = asset
      }
      doc.assets = rebuilt
    })
  }

  const doImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    await importFiles(Array.from(files))
  }

  const removeAsset = (id: string) => {
    void (async () => {
      const doc0 = useEditorStore.getState().document
      // Kaskade: layer overlay yang menempel pada aset ini ikut dihapus,
      // termasuk aset (blob + record) miliknya.
      const overlayAssetIdsToRemove = doc0.layers
        .filter((l) => l.type === 'image' && l.ownerAssetId === id)
        .map((l) => (l.type === 'image' ? l.assetId : ''))
        .filter(Boolean)
      const idsToRemove = [id, ...overlayAssetIdsToRemove]
      for (const assetId of idsToRemove) {
        const asset = doc0.assets[assetId]
        if (asset?.objectKey) await deleteAssetRecord(assetId).catch(() => undefined)
        await deleteAssetBlob(assetId)
      }
      mutate((doc) => {
        for (const assetId of idsToRemove) delete doc.assets[assetId]
        // Remove the image layer, every text/rect layer owned by this asset,
        // and any overlay image layer attached to it.
        doc.layers = doc.layers.filter(
          (l) => l.assetId !== id && !(l.type === 'image' && l.ownerAssetId === id),
        )
        useEditorStore.getState().setSelection(
          useEditorStore.getState().selection.filter((selId) =>
            doc.layers.some((l) => l.id === selId),
          ),
        )
      })
      if (activeAssetId === id) {
        const next = useEditorStore.getState().document
        const fallback = next.layers.find(
          (l) => l.type === 'image' && !l.ownerAssetId && l.visible,
        )
        setActiveAsset(fallback && fallback.type === 'image' ? fallback.assetId : null)
      }
    })()
  }

  return (
    <div
      className={cn(
        'shrink-0 border-t border-border bg-card',
        dragOver && 'bg-accent/30 outline-2 -outline-offset-2 outline-dashed outline-accent',
      )}
      onDragOver={(e) => {
        // Hanya file (import) yang memicu highlight — seretan internal antar
        // thumbnail tidak dianggap "jatuhkan file di sini".
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        void doImport(e.dataTransfer.files)
      }}
    >
      <div className="flex items-stretch gap-2 overflow-x-auto p-2">
        {orderedAssets.length === 0 && (
          <p className="self-center px-2 text-xs text-muted-foreground">
            Belum ada screenshot — klik tombol Import atau seret file gambar ke sini.
          </p>
        )}
        {orderedAssets.map((asset) => (
          <FilmThumb
            key={asset.id}
            asset={asset}
            active={activeAssetId === asset.id}
            beingDragged={dragId === asset.id}
            onActivate={() => {
              setActiveAsset(asset.id)
              useEditorStore.getState().setSelection([])
            }}
            onRemove={() => removeAsset(asset.id)}
            onRetry={() => retryUpload(asset.id)}
            onDragStart={() => setDragId(asset.id)}
            onDragEnd={() => setDragId(null)}
            onDrop={() => dropOn(asset.id)}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          className="my-auto h-auto min-h-14 shrink-0 flex-col gap-1"
          aria-label="Import images"
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus />
          <span className="text-[10px]">Import</span>
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => {
            void doImport(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

function FilmThumb(props: {
  asset: AssetRef
  active: boolean
  beingDragged: boolean
  onActivate: () => void
  onRemove: () => void
  onRetry: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDrop: () => void
}) {
  const { asset, active } = props
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    void resolveAssetUrl(asset).then((u) => {
      if (cancelled) return
      objectUrl = u
      setUrl(u)
    })
    return () => {
      cancelled = true
      if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
    }
  }, [asset.id, asset.objectKey, asset.status, asset])

  return (
    <div
      className={cn(
        'group relative h-14 w-24 shrink-0 overflow-hidden rounded-md border',
        active
          ? 'border-primary ring-2 ring-primary shadow-[0_0_12px_-2px_var(--color-primary)]'
          : 'border-border opacity-80 hover:opacity-100',
        props.beingDragged && 'opacity-40',
      )}
      draggable
      onDragStart={(e) => {
        // Set data agar drag pasti dimulai di semua browser, dan nonaktifkan
        // drag natif <img> yang selama ini menelan gesture seretan user.
        e.dataTransfer.setData('text/plain', asset.id)
        e.dataTransfer.effectAllowed = 'move'
        props.onDragStart()
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        props.onDrop()
      }}
      onDragEnd={props.onDragEnd}
    >
      <button
        type="button"
        className="relative block size-full cursor-pointer"
        onClick={props.onActivate}
        aria-label={`Show ${asset.name} on canvas`}
        title={`${asset.name} · ${asset.width}×${asset.height}`}
      >
        {url ? (
          <img
            src={url}
            alt={asset.name}
            className="size-full object-cover"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-secondary/60">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {active && (
          <span className="absolute bottom-0 left-0 rounded-tr-sm bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            Aktif
          </span>
        )}
        {asset.status === 'uploading' && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-muted">
            <span
              className="block h-full bg-primary transition-all"
              style={{ width: `${asset.uploadProgress}%` }}
            />
          </span>
        )}
      </button>
      {asset.status === 'error' && (
        <button
          type="button"
          className="absolute inset-0 flex cursor-pointer items-center justify-center gap-1 bg-destructive/80 text-[10px] text-white"
          onClick={props.onRetry}
        >
          <RefreshCw className="size-3" /> Retry
        </button>
      )}
      <button
        type="button"
        aria-label={`Delete ${asset.name}`}
        onClick={props.onRemove}
        className="absolute top-0.5 right-0.5 flex cursor-pointer rounded-sm bg-black/70 p-1 text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}
