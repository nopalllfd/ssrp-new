import { newTextLayer } from '@/store/editor'
import type { EditorDocument, Layer } from '@/types/editor'

/** Semua layer text hasil automasi chatlog memakai nama berawalan ini. */
export const CHATLOG_LAYER_PREFIX = 'Chatlog'

/** Gaya teks chatlog yang diterapkan ke gambar. */
export interface ChatlogStyle {
  /** Jumlah kalimat di blok atas tiap gambar. */
  topCount: number
  /** Jumlah kalimat di blok bawah-kiri tiap gambar. */
  bottomCount: number
  /** Jarak tepi (px) dari batas gambar. */
  margin: number
  fontFamily: string
  fontSize: number
  fontWeight: 400 | 500 | 600 | 700 | 800
  fontStyle: 'normal' | 'italic'
  align: 'left' | 'center' | 'right'
  lineHeight: number
  fill: string
  stroke: string
  strokeWidth: number
  shadowBlur: number
}

export const DEFAULT_CHATLOG_STYLE: ChatlogStyle = {
  topCount: 5,
  bottomCount: 5,
  margin: 12,
  fontFamily: 'Arial',
  fontSize: 24,
  fontWeight: 700,
  fontStyle: 'normal',
  align: 'left',
  lineHeight: 1.2,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  shadowBlur: 4,
}

/** Potong isi file menjadi daftar kalimat: trim per baris + buang baris kosong. */
export function parseChatlogLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Aset yang berupa overlay (layer image dengan ownerAssetId) — bukan gambar utama. */
function overlayAssetIds(doc: EditorDocument): Set<string> {
  const ids = new Set<string>()
  for (const layer of doc.layers) {
    if (layer.type === 'image' && layer.ownerAssetId) ids.add(layer.assetId)
  }
  return ids
}

type MainImageLayer = Extract<EditorDocument['layers'][number], { type: 'image' }>

/** Cari layer image utama (bukan overlay) untuk sebuah aset. */
function mainImageLayer(doc: EditorDocument, assetId: string): MainImageLayer | undefined {
  return doc.layers.find(
    (l): l is MainImageLayer =>
      l.type === 'image' && l.assetId === assetId && !l.ownerAssetId,
  )
}

/**
 * Area gambar yang benar-benar terlihat di canvas = irisan kotak gambar dengan
 * kotak canvas. Gambar boleh menonjol keluar canvas (canvas hanya clip), jadi
 * posisi chatlog harus dihitung dari irisan ini agar tidak jatuh di area clip.
 */
function visibleImageBox(
  doc: EditorDocument,
  img: { x: number; y: number; width: number; height: number },
): { left: number; top: number; right: number; bottom: number } {
  const left = Math.max(img.x, 0)
  const top = Math.max(img.y, 0)
  const right = Math.max(Math.min(img.x + img.width, doc.canvas.width), left)
  const bottom = Math.max(Math.min(img.y + img.height, doc.canvas.height), top)
  return { left, top, right, bottom }
}

/** Perkiraan tinggi blok chatlog: jumlah baris × ukuran font × line height. */
function estimatedBlockHeight(lineCount: number, fontSize: number, lineHeight: number): number {
  return lineCount * fontSize * lineHeight
}

/**
 * Terapkan chatlog ke seluruh gambar — SATU pemanggilan = SATU langkah history
 * (panggil di dalam `mutate`).
 *
 * - Menghapus semua layer chatlog lama (idempoten: apply ulang = hasil sama).
 * - Iterasi aset sesuai urutan filmstrip, konsumsi `topCount` baris untuk blok
 *   atas lalu `bottomCount` baris untuk blok bawah-kiri, berurutan antar gambar.
 * - Sisa baris yang tidak muat diabaikan.
 *
 * @returns jumlah gambar yang mendapat layer chatlog.
 */
export function applyChatlogToDocument(
  doc: EditorDocument,
  lines: string[],
  style: ChatlogStyle,
): number {
  // Idempoten: buang layer chatlog hasil apply sebelumnya.
  doc.layers = doc.layers.filter(
    (l) => !(l.type === 'text' && l.name.startsWith(CHATLOG_LAYER_PREFIX)),
  )

  const skipAssets = overlayAssetIds(doc)
  const created: Layer[] = []
  let index = 0
  let applied = 0

  for (const assetId of Object.keys(doc.assets)) {
    if (skipAssets.has(assetId)) continue
    if (index >= lines.length) break

    const img = mainImageLayer(doc, assetId)
    if (!img) continue

    const topLines = lines.slice(index, index + style.topCount)
    index += topLines.length
    const bottomLines = lines.slice(index, index + style.bottomCount)
    index += bottomLines.length
    if (topLines.length === 0 && bottomLines.length === 0) break

    const base = {
      assetId,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      align: style.align,
      lineHeight: style.lineHeight,
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      shadowBlur: style.shadowBlur,
      chatlogMargin: style.margin,
    } as const

    // Posisi dihitung dari area gambar yang terlihat di canvas (bukan kotak
    // gambar penuh) agar tidak jatuh di area yang di-clip canvas.
    const box = visibleImageBox(doc, img)

    if (topLines.length > 0) {
      created.push(
        newTextLayer({
          ...base,
          name: `${CHATLOG_LAYER_PREFIX} atas`,
          x: box.left + style.margin,
          y: box.top + style.margin,
          text: topLines.join('\n'),
        }),
      )
    }

    if (bottomLines.length > 0) {
      // Perkiraan tinggi blok: jumlah baris × ukuran font × line height,
      // lalu dijepit agar tidak keluar dari tepi atas area yang terlihat.
      const estimatedHeight = estimatedBlockHeight(
        bottomLines.length,
        style.fontSize,
        style.lineHeight,
      )
      const bottomY = Math.max(
        box.top + style.margin,
        box.bottom - style.margin - estimatedHeight,
      )
      created.push(
        newTextLayer({
          ...base,
          name: `${CHATLOG_LAYER_PREFIX} bawah`,
          x: box.left + style.margin,
          y: bottomY,
          text: bottomLines.join('\n'),
        }),
      )
    }

    applied += 1
  }

  doc.layers.push(...created)
  return applied
}

/** Hitung jumlah gambar utama (tanpa overlay) — untuk info di panel/dialog. */
export function countMainImages(doc: EditorDocument): number {
  const skipAssets = overlayAssetIds(doc)
  let count = 0
  for (const assetId of Object.keys(doc.assets)) {
    if (skipAssets.has(assetId)) continue
    if (
      doc.layers.some((l) => l.type === 'image' && l.assetId === assetId && !l.ownerAssetId)
    ) {
      count += 1
    }
  }
  return count
}

/**
 * Posisikan ulang semua layer chatlog (atas & bawah) mengikuti gambar
 * induknya — panggil setelah crop/canvas berubah (di dalam `mutate` yang sama)
 * supaya blok chatlog, termasuk blok bawah, selalu berada di area canvas
 * yang terlihat dan tidak menempel di koordinat lama.
 */
export function refitChatlogLayers(doc: EditorDocument): void {
  for (const layer of doc.layers) {
    if (layer.type !== 'text' || !layer.name.startsWith(CHATLOG_LAYER_PREFIX)) continue
    if (!layer.assetId) continue
    const img = mainImageLayer(doc, layer.assetId)
    if (!img) continue

    const margin = layer.chatlogMargin ?? DEFAULT_CHATLOG_STYLE.margin
    const box = visibleImageBox(doc, img)
    layer.x = box.left + margin

    if (layer.name.endsWith('bawah')) {
      const estimatedHeight = estimatedBlockHeight(
        layer.text.split('\n').length,
        layer.fontSize,
        layer.lineHeight,
      )
      layer.y = Math.max(box.top + margin, box.bottom - margin - estimatedHeight)
    } else {
      layer.y = box.top + margin
    }
  }
}
