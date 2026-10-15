import type { ShapeKind } from '@/types/editor'

export const SHAPE_KINDS: ShapeKind[] = ['rect', 'ellipse', 'triangle', 'diamond']

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  diamond: 'Diamond',
}

/**
 * Gambar path bentuk dalam koordinat lokal 0..width × 0..height (origin
 * kiri-atas, sama seperti Rect). Dipakai sceneFunc editor DAN exporter supaya
 * tampilan serta hasil ekspor identik; hit area Konva otomatis ikut path ini
 * (tanpa hitFunc, hit = gambar sceneFunc).
 */
export function drawShapePath(c: CanvasRenderingContext2D, kind: ShapeKind, w: number, h: number) {
  c.beginPath()
  switch (kind) {
    case 'ellipse':
      c.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      break
    case 'triangle':
      c.moveTo(w / 2, 0)
      c.lineTo(w, h)
      c.lineTo(0, h)
      c.closePath()
      break
    case 'diamond':
      c.moveTo(w / 2, 0)
      c.lineTo(w, h / 2)
      c.lineTo(w / 2, h)
      c.lineTo(0, h / 2)
      c.closePath()
      break
    default:
      c.rect(0, 0, w, h)
  }
}
