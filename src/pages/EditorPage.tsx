import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, PanelLeft, X } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEditorStore, newRectLayer, newTextLayer, duplicateLayer } from '@/store/editor'
import { usePersistence } from '@/hooks/usePersistence'
import { useAssets, deleteLayers } from '@/hooks/useAssets'
import { getProject, logActivity, renameProject } from '@/lib/api'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { EditorCanvas } from '@/components/editor/EditorCanvas'
import { FilmStrip } from '@/components/editor/FilmStrip'
import { ToolsPanel } from '@/components/editor/ToolsPanel'
import { LayersPanel } from '@/components/editor/LayersPanel'
import { RightPanel } from '@/components/editor/RightPanel'
import { CropDialog } from '@/components/editor/CropDialog'
import { ImageFilterDialog } from '@/components/editor/ImageFilterDialog'
import { VersionHistoryDialog } from '@/components/editor/VersionHistoryDialog'
import { ExportDialog } from '@/components/editor/ExportDialog'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/ui/misc'
import type { Layer } from '@/types/editor'

type EditorDialog = 'crop' | 'filter' | 'history' | 'export'

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const pid = projectId ?? ''

  const [projectName, setProjectName] = useState('')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<EditorDialog | null>(null)
  const [conflict, setConflict] = useState<{
    resolve: (choice: 'reload' | 'keep-local') => void
  } | null>(null)
  // Drawer mobile terbuka otomatis saat project baru dibuka di layar kecil
  // (sinkron dengan breakpoint md:hidden pada drawer). Setelah ditutup user,
  // tetap tertutup sampai pindah project.
  const [panelsOpen, setPanelsOpen] = useState(
    () => window.matchMedia('(max-width: 767.98px)').matches,
  )
  const [canvasDragOver, setCanvasDragOver] = useState(false)

  const { loadProject, saveNow, saveManualSnapshot } = usePersistence(pid, (resolve) =>
    setConflict({ resolve }),
  )
  const { pumpQueue, importFiles } = useAssets(pid)

  // ------------------------------------------------------------- loading
  useEffect(() => {
    if (!pid) return
    let cancelled = false
    void (async () => {
      try {
        const project = await getProject(pid)
        if (cancelled) return
        setProjectName(project.name)
        await loadProject()
        if (!cancelled) setLoadState('ready')
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Failed to load project')
          setLoadState('error')
        }
      }
    })()
    return () => {
      cancelled = true
      // The store is a page-level singleton — don't leak a project's document
      // into the next editor session.
      useEditorStore.getState().resetDocument()
    }
  }, [pid, loadProject])

  // Resume any uploads that were still queued when the page last closed.
  useEffect(() => {
    if (loadState === 'ready') void pumpQueue()
  }, [loadState, pumpQueue])

  // ------------------------------------------------------- canvas sizing
  const containerRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) {
        setStageSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadState])

  const zoomFit = useCallback(() => {
    const s = useEditorStore.getState()
    const { width: cw, height: chh } = s.document.canvas
    const { width, height } = stageSize
    if (!width || !height) return
    const zoom = Math.min((width - 48) / cw, (height - 48) / chh)
    s.setZoom(zoom)
    s.setStagePos({ x: (width - cw * zoom) / 2, y: (height - chh * zoom) / 2 })
  }, [stageSize])

  const canvasWidth = useEditorStore((s) => s.document.canvas.width)
  const canvasHeight = useEditorStore((s) => s.document.canvas.height)
  const hasAssets = useEditorStore((s) => Object.keys(s.document.assets).length > 0)

  // Camera always fits the canvas: re-fit on first load, window resize, and
  // whenever the canvas dimensions change. Manual zoom/pan still works in
  // between fits.
  useEffect(() => {
    if (loadState !== 'ready' || stageSize.width === 0 || stageSize.height === 0) return
    zoomFit()
  }, [loadState, stageSize, canvasWidth, canvasHeight, zoomFit])

  // ------------------------------------------------------------- actions
  const addLayer = (layer: Layer) => {
    const s = useEditorStore.getState()
    // Text/shape layers are unique per image: scope them to the active asset.
    if (layer.type !== 'image') layer.assetId = s.activeAssetId
    s.mutate((doc) => {
      doc.layers.push(layer)
    })
    s.setSelection([layer.id])
  }

  const onRename = async (name: string) => {
    const previous = projectName
    setProjectName(name)
    try {
      await renameProject(pid, name)
      void logActivity({ projectId: pid, action: 'project.rename', metadata: { name } })
    } catch {
      setProjectName(previous)
    }
  }

  const onBack = () => {
    void saveNow('manual')
    navigate('/')
  }

  const resolveConflict = (choice: 'reload' | 'keep-local') => {
    conflict?.resolve(choice)
    setConflict(null)
  }

  // ---------------------------------------------------- keyboard shortcuts
  useEffect(() => {
    if (loadState !== 'ready') return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const s = useEditorStore.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        s.undo()
        return
      }
      if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) {
        e.preventDefault()
        s.redo()
        return
      }
      if (mod && key === 's') {
        e.preventDefault()
        void saveNow('manual')
        return
      }
      if (key === 'escape') {
        s.setSelection([])
        return
      }
      if (key === 'delete' || key === 'backspace') {
        if (s.selection.length === 0) return
        e.preventDefault()
        // Overlay (objek tempel) yang dihapus turut melepas aset miliknya.
        deleteLayers(s.selection, { skipLocked: true })
        return
      }
      if (mod && key === 'd') {
        if (s.selection.length === 0) return
        e.preventDefault()
        const ids = new Set(s.selection)
        const newIds: string[] = []
        s.mutate((doc) => {
          const copies = doc.layers
            .filter((l) => ids.has(l.id))
            .map((l) => duplicateLayer(l))
          for (const copy of copies) newIds.push(copy.id)
          doc.layers.push(...copies)
        })
        useEditorStore.getState().setSelection(newIds)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loadState, saveNow])

  // -------------------------------------------------------------- render
  if (!projectId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Invalid project URL.</p>
      </div>
    )
  }

  if (loadState === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">{loadError ?? 'Failed to load project.'}</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          Back to dashboard
        </Button>
      </div>
    )
  }

  if (loadState === 'loading') {
    return <LoadingScreen label="Loading project…" />
  }

  return (
    // h-dvh: tinggi viewport dinamis — di mobile, address bar yang menyusut
    // tidak membuat area editor terpotong / menghasilkan scroll ganda.
    <div className="flex h-dvh flex-col overflow-hidden">
      <EditorToolbar
        projectName={projectName}
        onRename={(name) => void onRename(name)}
        onBack={onBack}
        onSaveNow={() => void saveNow('manual')}
        onZoomFit={zoomFit}
        onZoomReset={() => useEditorStore.getState().setZoom(1)}
        onAddText={() => addLayer(newTextLayer())}
        onAddShape={(shape) => addLayer(newRectLayer({ shape }))}
        onOpenCrop={() => setDialog('crop')}
        onOpenFilter={() => setDialog('filter')}
        onOpenHistory={() => setDialog('history')}
        onOpenExport={() => setDialog('export')}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-r border-border bg-card md:flex">
          <ToolsPanel />
          <LayersPanel projectId={pid} />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-background">
          <div
            ref={containerRef}
            className="relative min-h-0 flex-1"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault()
                setCanvasDragOver(true)
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setCanvasDragOver(false)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              setCanvasDragOver(false)
              void importFiles(Array.from(e.dataTransfer.files))
            }}
          >
            {stageSize.width > 0 && stageSize.height > 0 && (
              <EditorCanvas width={stageSize.width} height={stageSize.height} />
            )}
            {!hasAssets && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border/80 bg-card/70 px-8 py-6 text-muted-foreground">
                  <ImagePlus className="size-8" />
                  <p className="text-sm font-medium">Seret & lepas gambar di sini untuk upload</p>
                  <p className="text-xs">atau klik tombol Import di strip bawah</p>
                </div>
              </div>
            )}
            {canvasDragOver && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-accent/40">
                <p className="rounded-md bg-card px-3 py-1.5 text-sm font-medium shadow">
                  Lepaskan gambar untuk import
                </p>
              </div>
            )}
          </div>
          <FilmStrip projectId={pid} />
        </main>

        {/* gutter stabil: lebar konten tidak mengecil saat scrollbar muncul
            (mis. saat memilih layer chatlog → panel Properties jadi tinggi). */}
        <aside className="app-scrollbar hidden w-80 shrink-0 overflow-y-auto [scrollbar-gutter:stable] border-l border-border bg-card lg:block">
          <RightPanel />
        </aside>
      </div>

      {/* Mobile: panels live in a slide-over drawer. */}
      <button
        type="button"
        aria-label="Open panels"
        className="fixed bottom-4 left-4 z-30 flex size-11 cursor-pointer items-center justify-center rounded-full border border-border bg-card shadow-lg md:hidden"
        onClick={() => setPanelsOpen(true)}
      >
        <PanelLeft className="size-5" />
      </button>
      {panelsOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setPanelsOpen(false)}
          />
          <div className="app-scrollbar absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col overflow-y-auto [scrollbar-gutter:stable] border-r border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Panels</span>
              <button
                type="button"
                aria-label="Close panels"
                className="cursor-pointer rounded-md p-1 hover:bg-accent"
                onClick={() => setPanelsOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            <ToolsPanel />
            <LayersPanel projectId={pid} />
            <RightPanel />
          </div>
        </div>
      )}

      <CropDialog open={dialog === 'crop'} onOpenChange={(o) => setDialog(o ? 'crop' : null)} />
      <ImageFilterDialog
        open={dialog === 'filter'}
        onOpenChange={(o) => setDialog(o ? 'filter' : null)}
      />
      <VersionHistoryDialog
        open={dialog === 'history'}
        onOpenChange={(o) => setDialog(o ? 'history' : null)}
        projectId={pid}
        onSaveManualSnapshot={saveManualSnapshot}
      />
      <ExportDialog
        open={dialog === 'export'}
        onOpenChange={(o) => setDialog(o ? 'export' : null)}
        projectId={pid}
      />

      {/* Revision conflict: someone else (or another tab) saved first. */}
      <Dialog open={!!conflict} onOpenChange={() => undefined}>
        <DialogContent title="Perubahan bentrok">
          <p className="mb-4 text-sm text-muted-foreground">
            Proyek ini baru saja disimpan dari sesi lain. Pilih versi yang ingin
            dipertahankan.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => resolveConflict('reload')}>
              Muat versi cloud
            </Button>
            <Button onClick={() => resolveConflict('keep-local')}>
              Timpa dengan milik saya
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
