import { useState } from 'react'
import { Check, Copy, Download, Globe } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import {
  buildExportFiles,
  buildSnippets,
  downloadFiles,
  publishFiles,
  type PublishedFile,
  type PublishSnippets,
} from '@/lib/exporter'
import { logActivity } from '@/lib/api'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label, Select, Slider, Textarea } from '@/components/ui/misc'
import { ColorField } from '@/components/editor/PropertiesPanel'
import type { ExportDefaults } from '@/types/editor'

/**
 * Export & publish. One pipeline builds the file set (canvas composite or
 * per-image crops); the user then downloads them (single file or ZIP) or
 * publishes them to the public bucket for forum-ready links.
 */
export function ExportDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}) {
  const document = useEditorStore((s) => s.document)
  const mutate = useEditorStore((s) => s.mutate)

  const defaults = document.exportDefaults
  const [options, setOptions] = useState<ExportDefaults & { mode: 'canvas' | 'assets' }>({
    ...defaults,
    mode: 'canvas',
  })
  const [busy, setBusy] = useState<'download' | 'publish' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [published, setPublished] = useState<PublishedFile[] | null>(null)
  const [snippets, setSnippets] = useState<PublishSnippets | null>(null)

  const hasImages = document.layers.some((l) => l.type === 'image')
  const hasContent = document.layers.length > 0

  const update = <K extends keyof typeof options>(key: K, value: (typeof options)[K]) =>
    setOptions((o) => ({ ...o, [key]: value }))

  const persistDefaults = () => {
    // Remember the last-used export settings in the document itself.
    mutate(
      (doc) => {
        doc.exportDefaults = {
          format: options.format,
          quality: options.quality,
          prefix: options.prefix,
          scale: options.scale,
          background: options.background,
        }
      },
      { coalesce: true },
    )
  }

  const run = async (action: 'download' | 'publish') => {
    setBusy(action)
    setError(null)
    setPublished(null)
    setSnippets(null)
    try {
      persistDefaults()
      const files = await buildExportFiles(useEditorStore.getState().document, {
        ...options,
        activeAssetId: useEditorStore.getState().activeAssetId,
      })
      if (action === 'download') {
        downloadFiles(files, options.prefix)
        void logActivity({
          projectId,
          action: 'export.download',
          metadata: { mode: options.mode, format: options.format, count: files.length },
        })
      } else {
        const result = await publishFiles(projectId, files)
        setPublished(result)
        setSnippets(buildSnippets(result))
        void logActivity({
          projectId,
          action: 'export.publish',
          metadata: { mode: options.mode, format: options.format, count: files.length },
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Export & publish"
        onClose={() => onOpenChange(false)}
        className="max-w-xl"
      >
        {!hasContent && (
          <p className="mb-3 rounded-md border border-border bg-secondary/40 p-2 text-xs text-muted-foreground">
            Canvas masih kosong — tambahkan gambar, teks, atau shape dulu untuk hasil
            yang bermakna.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Export source</Label>
            <Select
              className="mt-1"
              value={options.mode}
              onChange={(e) => update('mode', e.target.value as 'canvas' | 'assets')}
            >
              <option value="canvas">Canvas (composite tunggal)</option>
              <option value="assets" disabled={!hasImages}>
                Per-image crops (ZIP)
              </option>
            </Select>
          </div>
          <div>
            <Label>Format</Label>
            <Select
              className="mt-1"
              value={options.format}
              onChange={(e) => update('format', e.target.value as ExportDefaults['format'])}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </Select>
          </div>
          <div>
            <Label>File name prefix</Label>
            <Input
              className="mt-1"
              value={options.prefix}
              onChange={(e) => update('prefix', e.target.value)}
            />
          </div>
          <div>
            <Label>Scale (canvas mode)</Label>
            <Select
              className="mt-1"
              value={String(options.scale)}
              onChange={(e) => update('scale', Number(e.target.value))}
            >
              <option value="1">1×</option>
              <option value="2">2×</option>
              <option value="3">3×</option>
            </Select>
          </div>
        </div>

        {options.format !== 'png' && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 flex justify-between">
                <Label>Quality</Label>
                <span className="text-xs text-muted-foreground">
                  {Math.round(options.quality * 100)}%
                </span>
              </div>
              <Slider
                min={0.5}
                max={1}
                step={0.01}
                value={options.quality}
                onChange={(e) => update('quality', Number(e.target.value))}
              />
            </div>
            <ColorField
              label="Background (flatten)"
              value={options.background}
              onChange={(v) => update('background', v)}
            />
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <Button
            className="flex-1"
            onClick={() => void run('download')}
            disabled={busy !== null || !hasContent}
          >
            <Download />
            {busy === 'download' ? 'Rendering…' : options.mode === 'assets' ? 'Download ZIP' : 'Download'}
          </Button>
          <Button
            className="flex-1"
            variant="secondary"
            onClick={() => void run('publish')}
            disabled={busy !== null || !hasContent}
          >
            <Globe />
            {busy === 'publish' ? 'Publishing…' : 'Publish & copy links'}
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Publish mengunggah hasil export ke bucket publik dan memberi URL permanen
          untuk forum (BBCode), Markdown, dan HTML.
        </p>

        {published && snippets && (
          <div className="mt-4 border-t border-border pt-3">
            <Label>Published {published.length} file(s)</Label>
            <div className="mt-2 flex flex-col gap-3">
              <SnippetBox label="Direct URLs" value={snippets.urls} />
              <SnippetBox label="BBCode" value={snippets.bbcode} />
              <SnippetBox label="Markdown" value={snippets.markdown} />
              <SnippetBox label="HTML" value={snippets.html} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SnippetBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — user can select text manually */
    }
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <Textarea readOnly value={value} rows={Math.min(4, value.split('\n').length)} className="text-[11px]" />
    </div>
  )
}
