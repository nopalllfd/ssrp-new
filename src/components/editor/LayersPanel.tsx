import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Paperclip,
  Square,
  Trash2,
} from 'lucide-react'
import { useEditorStore, duplicateLayer } from '@/store/editor'
import { useAssets, deleteLayers } from '@/hooks/useAssets'
import { layerVisibleForAsset } from '@/lib/editorDocument'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Layer } from '@/types/editor'

export function LayersPanel({ projectId }: { projectId: string }) {
  const document = useEditorStore((s) => s.document)
  const selection = useEditorStore((s) => s.selection)
  const setSelection = useEditorStore((s) => s.setSelection)
  const addToSelection = useEditorStore((s) => s.addToSelection)
  const mutate = useEditorStore((s) => s.mutate)
  const activeAssetId = useEditorStore((s) => s.activeAssetId)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const { importFiles } = useAssets(projectId)
  const overlayInput = useRef<HTMLInputElement>(null)
  const [attachDragOver, setAttachDragOver] = useState(false)

  const doAttachImage = async (files: FileList | null) => {
    if (!files || files.length === 0 || !activeAssetId) return
    await importFiles(Array.from(files), { overlayOn: activeAssetId })
  }

  // Layers are scoped per image: this list only shows what actually renders
  // on the canvas right now (the active image + its text/shapes).
  const visible = document.layers.filter((l) => layerVisibleForAsset(l, activeAssetId))
  // Display top-most layer first in the list.
  const display = [...visible].reverse()
  const activeName = activeAssetId ? document.assets[activeAssetId]?.name : null

  // A pending drag offset is meaningless after switching images.
  useEffect(() => setDragIndex(null), [activeAssetId])

  const moveLayer = (id: string, direction: 1 | -1) => {
    mutate((doc) => {
      const subset = doc.layers.filter((l) => layerVisibleForAsset(l, activeAssetId))
      const si = subset.findIndex((l) => l.id === id)
      const target = si < 0 ? undefined : subset[si + direction]
      if (si < 0 || !target) return
      const i = doc.layers.findIndex((l) => l.id === id)
      const j = doc.layers.findIndex((l) => l.id === target.id)
      if (i < 0 || j < 0) return
      doc.layers[i] = target
      doc.layers[j] = subset[si]!
    })
  }

  const dropAt = (displayIndex: number) => {
    if (dragIndex === null || dragIndex === displayIndex) return
    mutate((doc) => {
      const subset = doc.layers.filter((l) => layerVisibleForAsset(l, activeAssetId))
      const moved = subset[subset.length - 1 - dragIndex]
      if (!moved) return
      doc.layers = doc.layers.filter((l) => l.id !== moved.id)
      // Insert before the layer that should sit right above the drop slot.
      const remaining = doc.layers.filter((l) => layerVisibleForAsset(l, activeAssetId))
      const fi = Math.min(
        Math.max(subset.length - 1 - displayIndex, 0),
        remaining.length,
      )
      const anchor = remaining[fi]
      const docIndex = anchor
        ? doc.layers.findIndex((l) => l.id === anchor.id)
        : doc.layers.length
      doc.layers.splice(docIndex, 0, moved)
    })
    setDragIndex(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <h3 className="text-sm font-semibold">Layers</h3>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {activeName ? `Milik gambar: ${activeName}` : 'Tanpa gambar aktif'}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {display.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            {activeAssetId
              ? 'Belum ada layer di gambar ini. Tambah text atau shape.'
              : 'Import gambar dulu — layer ditampilkan per gambar.'}
          </p>
        )}
        {display.map((layer, index) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            selected={selection.includes(layer.id)}
            onSelect={(shift) => {
              if (shift) addToSelection(layer.id)
              else setSelection([layer.id])
              // Selecting an image layer also makes its asset the one shown on canvas.
              // Overlay menempel pada gambar aktif — tidak menggantikannya.
              if (layer.type === 'image' && !layer.ownerAssetId) {
                useEditorStore.getState().setActiveAsset(layer.assetId)
              }
            }}
            onToggleVisible={() =>
              mutate((doc) => {
                const l = doc.layers.find((x) => x.id === layer.id)
                if (l) l.visible = !l.visible
              })
            }
            onToggleLock={() =>
              mutate((doc) => {
                const l = doc.layers.find((x) => x.id === layer.id)
                if (l) l.locked = !l.locked
              })
            }
            onDuplicate={() =>
              mutate((doc) => {
                const i = doc.layers.findIndex((x) => x.id === layer.id)
                const source = doc.layers[i]
                if (source !== undefined) doc.layers.splice(i + 1, 0, duplicateLayer(source))
              })
            }
            onDelete={() => deleteLayers([layer.id])}
            onMoveUp={() => moveLayer(layer.id, 1)}
            onMoveDown={() => moveLayer(layer.id, -1)}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dropAt(index)}
          />
        ))}
      </div>
      <div className="border-t border-border p-2">
        <div
          role="button"
          tabIndex={0}
          aria-label="Tempel gambar di atas gambar aktif"
          aria-disabled={!activeAssetId}
          title="Menambah objek berupa gambar yang menimpa gambar aktif"
          className={cn(
            'flex min-h-28 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-4 text-center transition-colors',
            activeAssetId
              ? 'cursor-pointer border-border hover:border-primary/60 hover:bg-accent/40'
              : 'cursor-not-allowed border-border/60 opacity-50',
            attachDragOver && 'border-primary bg-accent/40',
          )}
          onClick={() => {
            if (activeAssetId) overlayInput.current?.click()
          }}
          onKeyDown={(e) => {
            if (!activeAssetId) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              overlayInput.current?.click()
            }
          }}
          onDragOver={(e) => {
            if (!activeAssetId) return
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setAttachDragOver(true)
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setAttachDragOver(false)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            setAttachDragOver(false)
            void doAttachImage(e.dataTransfer.files)
          }}
        >
          <Paperclip className="size-5 text-muted-foreground" />
          <span className="text-xs font-medium">Tempel objek gambar</span>
          <span className="text-[10px] text-muted-foreground">
            Klik atau seret gambar ke sini — menjadi objek baru yang menimpa gambar aktif.
          </span>
        </div>
        <input
          ref={overlayInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => {
            void doAttachImage(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

function LayerRow(props: {
  layer: Layer
  selected: boolean
  onSelect: (shift: boolean) => void
  onToggleVisible: () => void
  onToggleLock: () => void
  onDuplicate: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  draggable: boolean
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
}) {
  const { layer, selected } = props
  const Icon =
    layer.type === 'image' ? ImageIcon : layer.type === 'text' ? CaseSensitive : Square

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md px-2 py-1.5',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
      )}
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        onClick={(e) => props.onSelect(e.shiftKey)}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs">{layer.name}</span>
      </button>
      <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
        <IconBtn label="Move up" onClick={props.onMoveUp}>
          <ArrowUp />
        </IconBtn>
        <IconBtn label="Move down" onClick={props.onMoveDown}>
          <ArrowDown />
        </IconBtn>
        <IconBtn label="Duplicate" onClick={props.onDuplicate}>
          <Copy />
        </IconBtn>
        <IconBtn label="Delete" onClick={props.onDelete}>
          <Trash2 />
        </IconBtn>
      </div>
      <IconBtn label={layer.visible ? 'Hide' : 'Show'} onClick={props.onToggleVisible}>
        {layer.visible ? <Eye /> : <EyeOff />}
      </IconBtn>
      <IconBtn label={layer.locked ? 'Unlock' : 'Lock'} onClick={props.onToggleLock}>
        {layer.locked ? <Lock /> : <LockOpen />}
      </IconBtn>
    </div>
  )
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <Button variant="ghost" size="icon" className="size-6" aria-label={label} onClick={onClick}>
      {children}
    </Button>
  )
}
