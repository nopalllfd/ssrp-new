import Konva from 'konva'
import type { ImageFilter } from '@/types/editor'

/** Nilai netral — identik dengan gambar asli. */
export const DEFAULT_IMAGE_FILTER: ImageFilter = {
  brightness: 0,
  contrast: 0,
  saturate: 0,
  hue: 0,
  blur: 0,
  noise: 0,
  grayscale: 0,
  sepia: 0,
}

export function isNeutralFilter(filter: ImageFilter | null | undefined): boolean {
  if (!filter) return true
  return (
    filter.brightness === 0 &&
    filter.contrast === 0 &&
    filter.saturate === 0 &&
    filter.hue === 0 &&
    filter.blur === 0 &&
    filter.noise === 0 &&
    filter.grayscale === 0 &&
    filter.sepia === 0
  )
}

/**
 * Filter Konva kustom: campurkan sebagian ke abu-abu (0 tak berubah, 1
 * hitam-putih penuh). Konva hanya punya grayscale on/off — versi parsial
 * ini membuat slider intensitas berarti.
 */
export function PartialGrayscaleFilter(this: Konva.Node, imageData: ImageData) {
  const amount = (this.getAttr('grayAmount') as number | undefined) ?? 1
  const d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] ?? 0
    const g0 = d[i + 1] ?? 0
    const b = d[i + 2] ?? 0
    const g = 0.299 * r + 0.587 * g0 + 0.114 * b
    d[i] = r + (g - r) * amount
    d[i + 1] = g0 + (g - g0) * amount
    d[i + 2] = b + (g - b) * amount
  }
}

/** Filter Konva kustom: campurkan sebagian ke sepia (0 tak berubah, 1 sepia penuh). */
export function PartialSepiaFilter(this: Konva.Node, imageData: ImageData) {
  const amount = (this.getAttr('sepiaAmount') as number | undefined) ?? 1
  const d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] ?? 0
    const g = d[i + 1] ?? 0
    const b = d[i + 2] ?? 0
    // Matriks sepia standar (ala Konva.Filters.Sepia) lalu lerp ke aslinya.
    const sr = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189)
    const sg = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168)
    const sb = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131)
    d[i] = r + (sr - r) * amount
    d[i + 1] = g + (sg - g) * amount
    d[i + 2] = b + (sb - b) * amount
  }
}

/**
 * Terapkan filter dokumen ke node Konva.Image: susun daftar filter, set
 * atributnya, lalu cache. Urutan: penyesuaian warna dulu, blur, terakhir
 * noise supaya bintik tetap tajam. Dipakai kanvas editor DAN exporter
 * supaya hasil ekspor sama dengan tampilan.
 */
export function applyKonvaImageFilter(
  node: Konva.Image,
  filter: ImageFilter | null | undefined,
) {
  if (isNeutralFilter(filter)) {
    node.clearCache()
    node.filters([])
    return
  }
  const f = filter as ImageFilter
  const filters: Konva.Filter[] = []
  if (f.grayscale > 0) filters.push(PartialGrayscaleFilter)
  if (f.sepia > 0) filters.push(PartialSepiaFilter)
  if (f.brightness !== 0) filters.push(Konva.Filters.Brighten)
  if (f.contrast !== 0) filters.push(Konva.Filters.Contrast)
  if (f.hue !== 0 || f.saturate !== 0) filters.push(Konva.Filters.HSL)
  if (f.blur > 0) filters.push(Konva.Filters.Blur)
  if (f.noise > 0) filters.push(Konva.Filters.Noise)

  // Konva HSL mengharapkan hue 0..360 — geser rentang -180..180.
  node.setAttr('grayAmount', f.grayscale)
  node.setAttr('sepiaAmount', f.sepia)
  node.setAttr('brightness', f.brightness)
  node.setAttr('contrast', f.contrast)
  node.setAttr('hue', ((f.hue % 360) + 360) % 360)
  node.setAttr('saturation', f.saturate)
  node.setAttr('luminance', 0)
  node.setAttr('blurRadius', f.blur)
  node.setAttr('noise', f.noise)
  node.filters(filters)
  node.cache()
}
