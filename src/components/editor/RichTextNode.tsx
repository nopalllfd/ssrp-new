import { useMemo } from 'react'
import { Shape } from 'react-konva'
import type Konva from 'konva'
import type { TextLayer } from '@/types/editor'
import { drawRichRuns, layoutRichText } from '@/lib/richText'

/**
 * Render text layer dengan gaya per-rangkaian karakter (styleRanges).
 * Konva.Text hanya mendukung satu gaya per shape, jadi layout +
 * penggambaran multi-style dilakukan manual lewat sceneFunc kustom.
 */
export function RichTextNode({
  layer,
  common,
  registerRef,
}: {
  layer: TextLayer
  common: Record<string, unknown>
  registerRef: (id: string, node: Konva.Node | null) => void
}) {
  const layout = useMemo(() => layoutRichText(layer, layer.styleRanges ?? []), [layer])

  return (
    <Shape
      {...common}
      ref={(n) => registerRef(layer.id, n)}
      width={layout.width}
      height={layout.height}
      // Bounds deklaratif: dipakai Transformer & isolation canvas shadow.
      selfRectFunc={() => ({ x: 0, y: 0, width: layout.width, height: layout.height })}
      sceneFunc={(ctx) => {
        // Stroke/shadow/letterSpacing digambar manual per-run (termasuk
        // override styleRanges), bukan lewat properti Konva.
        drawRichRuns(ctx._context, layout, {
          stroke: layer.stroke,
          strokeWidth: layer.strokeWidth,
          letterSpacing: layer.letterSpacing,
          shadowColor: layer.shadowColor,
          shadowBlur: layer.shadowBlur,
          shadowOffsetX: layer.shadowOffsetX,
          shadowOffsetY: layer.shadowOffsetY,
        })
      }}
      hitFunc={(ctx, shape) => {
        const c = ctx._context
        c.beginPath()
        c.rect(0, 0, layout.width, layout.height)
        ctx.fillStrokeShape(shape)
      }}
    />
  )
}
