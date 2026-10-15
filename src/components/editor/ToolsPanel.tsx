import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUpLeft,
  ArrowUpRight,
} from 'lucide-react'
import { newTextLayer, useEditorStore } from '@/store/editor'
import { layerVisibleForAsset } from '@/lib/editorDocument'
import { Button } from '@/components/ui/button'
import type { EditorDocument, Layer } from '@/types/editor'

type Corner = 'tl' | 'tr' | 'bl' | 'br'

const CORNERS: Array<{ key: Corner; label: string; icon: typeof ArrowUpLeft }> = [
  { key: 'tl', label: 'Kiri atas', icon: ArrowUpLeft },
  { key: 'tr', label: 'Kanan atas', icon: ArrowUpRight },
  { key: 'bl', label: 'Kiri bawah', icon: ArrowDownLeft },
  { key: 'br', label: 'Kanan bawah', icon: ArrowDownRight },
]

type TextLayer = Extract<Layer, { type: 'text' }>

function placeInCorner(layer: TextLayer, doc: EditorDocument, corner: Corner, margin: number) {
  const cw = doc.canvas.width
  const ch = doc.canvas.height
  const left = corner === 'tl' || corner === 'bl'
  const top = corner === 'tl' || corner === 'tr'
  layer.x = left ? margin : Math.max(0, cw - layer.width - margin)
  layer.y = top ? margin : Math.max(0, ch - layer.height - margin)
  layer.align = left ? 'left' : 'right'
}

export function ToolsPanel() {
  const mutate = useEditorStore((s) => s.mutate)
  const setSelection = useEditorStore((s) => s.setSelection)

  const applyCorner = (corner: Corner) => {
    const { selection, activeAssetId: active } = useEditorStore.getState()
    let createdId: string | null = null
    mutate((doc) => {
      const margin = Math.max(
        16,
        Math.round(Math.min(doc.canvas.width, doc.canvas.height) * 0.04),
      )
      let targets = doc.layers.filter(
        (l): l is TextLayer =>
          l.type === 'text' &&
          selection.includes(l.id) &&
          !l.locked &&
          layerVisibleForAsset(l, active),
      )
      if (targets.length === 0) {
        const created = newTextLayer({ assetId: active }) as TextLayer
        doc.layers.push(created)
        targets = [created]
        createdId = created.id
      }
      for (const layer of targets) placeInCorner(layer, doc, corner, margin)
    })
    if (createdId) setSelection([createdId])
  }

  return (
    <div className="flex flex-col gap-4 border-b border-border p-3">
      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Template posisi text
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {CORNERS.map(({ key, label, icon: Icon }) => (
            <Button key={key} variant="secondary" size="sm" onClick={() => applyCorner(key)}>
              <Icon /> {label}
            </Button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Memindahkan text yang dipilih; kalau belum ada, text baru dibuat di sudut itu.
        </p>
      </section>
    </div>
  )
}
