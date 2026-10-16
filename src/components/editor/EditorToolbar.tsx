import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  Circle,
  Crop,
  Diamond,
  Download,
  History,
  LayoutTemplate,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Save,
  SlidersHorizontal,
  Square,
  Triangle,
  Type,
  Undo2,
} from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/misc'
import { Dropdown, DropdownItem } from '@/components/ui/dropdown'
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
  onOpenTemplates,
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
  onOpenTemplates: () => void
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

  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(projectName)
  useEffect(() => setName(projectName), [projectName])

  const sync = SYNC_LABEL[syncStatus]

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1.5">
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

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <Button variant="ghost" size="icon" aria-label="Undo" disabled={!canUndo} onClick={undo}>
        <Undo2 />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Redo" disabled={!canRedo} onClick={redo}>
        <Redo2 />
      </Button>

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
        size="icon"
        aria-label="Fit to screen"
        className="hidden sm:inline-flex"
        onClick={onZoomFit}
      >
        <Maximize />
      </Button>
      <button
        type="button"
        className="hidden cursor-pointer rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent sm:block"
        onClick={onZoomReset}
        title="Reset zoom to 100%"
      >
        1:1
      </button>

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <Button variant="ghost" size="sm" onClick={onAddText}>
        <Type /> <span className="hidden md:inline">Text</span>
      </Button>
      <Dropdown
        trigger={
          <Button variant="ghost" size="sm">
            <Square /> <span className="hidden md:inline">Shape</span> <ChevronDown />
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
      <Button variant="ghost" size="sm" onClick={onOpenCrop} disabled={!hasImages}>
        <Crop /> <span className="hidden md:inline">Crop</span>
      </Button>
      <Button variant="ghost" size="sm" onClick={onOpenFilter} disabled={!hasImages}>
        <SlidersHorizontal /> <span className="hidden md:inline">Filter</span>
      </Button>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Save now" onClick={onSaveNow} disabled={!dirty}>
          <Save />
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenTemplates}>
          <LayoutTemplate /> <span className="hidden lg:inline">Templates</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenHistory}>
          <History /> <span className="hidden lg:inline">History</span>
        </Button>
        <Button size="sm" aria-label="Export" onClick={onOpenExport}>
          <Download /> <span className="hidden sm:inline">Export</span>
        </Button>
      </div>
    </header>
  )
}
