import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  Circle,
  Crop,
  Diamond,
  Download,
  History,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Save,
  SlidersHorizontal,
  Square,
  Trash2,
  Triangle,
  Type,
  Undo2,
} from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/misc'
import { Dropdown, DropdownItem } from '@/components/ui/dropdown'
import { deleteLayers } from '@/hooks/useAssets'
import { SHAPE_KINDS, SHAPE_NAMES } from '@/lib/shapes'
import type { ShapeKind, SyncStatus } from '@/types/editor'

const SHAPE_ICONS: Record<ShapeKind, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  triangle: Triangle,
  diamond: Diamond,
}

const SYNC_LABEL: Record<SyncStatus, { label: string; className: string }> = {
  synced: { label: 'Synced', className: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  local: { label: 'Saved locally', className: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  autosaving: { label: 'Autosaving…', className: 'text-sky-300 border-sky-500/30 bg-sky-500/10' },
  saving: { label: 'Saving…', className: 'text-sky-300 border-sky-500/30 bg-sky-500/10' },
  uploading: { label: 'Uploading…', className: 'text-sky-300 border-sky-500/30 bg-sky-500/10' },
  unsaved: { label: 'Unsaved changes', className: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  'save-failed': { label: 'Save failed', className: 'text-red-300 border-red-500/30 bg-red-500/10' },
  'upload-failed': { label: 'Upload failed', className: 'text-red-300 border-red-500/30 bg-red-500/10' },
  conflict: { label: 'Conflict', className: 'text-red-300 border-red-500/30 bg-red-500/10' },
}

export function EditorToolbar({
  projectName,
  onRename,
  onBack,
  onSaveNow,
  onZoomFit,
  onZoomReset,
  onAddText,
  onAddShape,
  onOpenCrop,
  onOpenFilter,
  onOpenHistory,
  onOpenExport,
}: {
  projectName: string
  onRename: (name: string) => void
  onBack: () => void
  onSaveNow: () => void
  onZoomFit: () => void
  onZoomReset: () => void
  onAddText: () => void
  onAddShape: (shape: ShapeKind) => void
  onOpenCrop: () => void
  onOpenFilter: () => void
  onOpenHistory: () => void
  onOpenExport: () => void
}) {
  const zoom = useEditorStore((s) => s.zoom)
  const setZoom = useEditorStore((s) => s.setZoom)
  const syncStatus = useEditorStore((s) => s.syncStatus)
  const canUndo = useEditorStore((s) => s.past.length > 0)
  const canRedo = useEditorStore((s) => s.future.length > 0)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const dirty = useEditorStore((s) => s.dirty)
  const hasImages = useEditorStore((s) => s.document.layers.some((l) => l.type === 'image'))
  const selection = useEditorStore((s) => s.selection)

  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(projectName)
  useEffect(() => setName(projectName), [projectName])

  const sync = SYNC_LABEL[syncStatus]

  return (
    <header className="flex shrink-0 flex-col gap-1 border-b border-border bg-card px-2 py-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1">
      {/* Baris judul: back, nama project, status sync, undo/redo */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Back to dashboard" onClick={onBack}>
          <ArrowLeft />
        </Button>

        {editingName ? (
          <Input
            autoFocus
            value={name}
            className="h-8 w-48 text-sm"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditingName(false)
              const trimmed = name.trim()
              if (trimmed && trimmed !== projectName) onRename(trimmed)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setName(projectName)
                setEditingName(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="max-w-56 cursor-text truncate rounded-md px-2 py-1 text-sm font-semibold hover:bg-accent"
            title="Click to rename"
            onClick={() => setEditingName(true)}
          >
            {projectName}
          </button>
        )}

        <Badge className={sync.className}>{sync.label}</Badge>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Undo" disabled={!canUndo} onClick={undo}>
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Redo" disabled={!canRedo} onClick={redo}>
            <Redo2 />
          </Button>
        </div>
      </div>

      {/* Baris 1: zoom — mobile: lebar penuh, konten di tengah */}
      <div className="flex w-full items-center justify-center gap-1 sm:w-auto">
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

        <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom(zoom / 1.2)}>
          <Minus />
        </Button>
        <span className="w-10 text-center text-xs text-muted-foreground tabular-nums sm:w-12">
          {Math.round(zoom * 100)}%
        </span>
        <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setZoom(zoom * 1.2)}>
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 sm:flex-none"
          aria-label="Fit to screen"
          onClick={onZoomFit}
        >
          <Maximize /> Fit
        </Button>
        <button
          type="button"
          className="flex-1 cursor-pointer rounded-md px-1.5 py-1 text-center text-xs text-muted-foreground hover:bg-accent sm:flex-none"
          onClick={onZoomReset}
          title="Reset zoom to 100%"
        >
          1:1
        </button>
      </div>

      {/* Baris 2: tools edit — mobile: lebar penuh, tiap tombol flex-1 & teks tampil */}
      <div className="flex w-full items-center justify-center gap-1 sm:w-auto">
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

        <Button variant="ghost" size="sm" className="flex-1 sm:flex-none" onClick={onAddText}>
          <Type /> Text
        </Button>
        <Dropdown
          className="flex-1 sm:flex-none"
          trigger={
            <Button variant="ghost" size="sm" className="w-full">
              <Square /> Shape <ChevronDown />
            </Button>
          }
        >
          {SHAPE_KINDS.map((kind) => {
            const Icon = SHAPE_ICONS[kind]
            return (
              <DropdownItem key={kind} onClick={() => onAddShape(kind)}>
                <Icon /> {SHAPE_NAMES[kind]}
              </DropdownItem>
            )
          })}
        </Dropdown>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 sm:flex-none"
          onClick={onOpenCrop}
          disabled={!hasImages}
        >
          <Crop /> Crop
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 sm:flex-none"
          onClick={onOpenFilter}
          disabled={!hasImages}
        >
          <SlidersHorizontal /> Filter
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 sm:flex-none"
          aria-label="Delete selected"
          title="Delete selected objects"
          onClick={() => deleteLayers(selection, { skipLocked: true })}
          disabled={selection.length === 0}
        >
          <Trash2 /> Delete
        </Button>
      </div>

      {/* Baris 3: save / history / export — mobile: lebar penuh, teks tampil */}
      <div className="flex w-full items-center justify-center gap-1 sm:ml-auto sm:w-auto">
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

        <Button
          variant="ghost"
          size="sm"
          className="flex-1 sm:flex-none"
          aria-label="Save now"
          onClick={onSaveNow}
          disabled={!dirty}
        >
          <Save /> Save
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none"
          onClick={onOpenHistory}
        >
          <History /> History
        </Button>
        <Button
          size="sm"
          className="flex-1 sm:flex-none"
          aria-label="Export"
          onClick={onOpenExport}
        >
          <Download /> Export
        </Button>
      </div>
    </header>
  )
}
