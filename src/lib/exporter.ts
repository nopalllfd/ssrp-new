import Konva from 'konva'
import JSZip from 'jszip'
import { nanoid } from 'nanoid'
import { supabase, PUBLISH_BUCKET } from '@/lib/supabase'
import {
  canvasToBlob,
  downloadBlob,
  loadAssetImage,
  renderAssetExport,
} from '@/lib/images'
import { defaultCropRule, effectiveCrop, layerVisibleForAsset } from '@/lib/editorDocument'
import { applyKonvaImageFilter } from '@/lib/imageFilters'
import { drawRichRuns, hasMixedAutoPurple, layoutRichText } from '@/lib/richText'
import type { CropRule, EditorDocument, ExportDefaults, Layer } from '@/types/editor'

export interface ExportFile {
  name: string
  blob: Blob
}

export interface ExportOptions extends ExportDefaults {
  /** 'canvas': single composite of all layers. 'assets': one file per image layer with its crop applied. */
  mode: 'canvas' | 'assets'
  /** Canvas mode renders exactly what the editor shows: this asset's image + its text/shape layers. */
  activeAssetId?: string | null
}

export function extensionFor(format: ExportDefaults['format']): string {
  return format === 'jpeg' ? 'jpg' : format
}

/** File name for one exported image, zero-padded for stable ZIP ordering. */
export function exportFileName(
  prefix: string,
  index: number | null,
  format: ExportDefaults['format'],
): string {
  const ext = extensionFor(format)
  const safe = prefix.trim().replace(/[^\w-]+/g, '-') || 'ssrp'
  return index === null ? `${safe}.${ext}` : `${safe}-${String(index).padStart(3, '0')}.${ext}`
}

/**
 * Render the whole document (background + visible layers, in order) to a
 * canvas using an offscreen Konva stage. Scale is the pixel multiplier.
 */
export async function renderDocumentToCanvas(
  document: EditorDocument,
  scale = 1,
  activeAssetId: string | null = null,
): Promise<HTMLCanvasElement> {
  const container = window.document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.pointerEvents = 'none'
  window.document.body.appendChild(container)

  const stage = new Konva.Stage({
    container,
    width: document.canvas.width,
    height: document.canvas.height,
  })
  try {
    const layer = new Konva.Layer()
    stage.add(layer)
    layer.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width: document.canvas.width,
        height: document.canvas.height,
        fill: document.canvas.background,
        listening: false,
      }),
    )

    for (const l of document.layers) {
      if (!l.visible) continue
      // Mirror the editor view: only layers owned by the active asset are
      // composited. The stage is canvas-sized, so anything past an edge is
      // cut off in the output — same as the on-screen clip.
      if (!layerVisibleForAsset(l, activeAssetId)) continue
      const node = await buildNode(l, document)
      if (node) layer.add(node)
    }

    return stage.toCanvas({ pixelRatio: Math.max(0.1, scale) })
  } finally {
    stage.destroy()
    container.remove()
  }
}

async function buildNode(l: Layer, document: EditorDocument): Promise<Konva.Shape | null> {
  const common = {
    x: l.x,
    y: l.y,
    width: l.width,
    height: l.height,
    rotation: l.rotation,
    opacity: l.opacity,
    listening: false,
  }

  if (l.type === 'image') {
    const asset = document.assets[l.assetId]
    if (!asset) return null
    const image = await loadAssetImage(asset)
    if (!image) return null
    const crop = effectiveCrop(l, document)
    const node = new Konva.Image({
      ...common,
      image,
      crop: crop
        ? {
            x: crop.region.x * asset.width,
            y: crop.region.y * asset.height,
            width: crop.region.w * asset.width,
            height: crop.region.h * asset.height,
          }
        : undefined,
    })
    // Paritas dengan kanvas editor: filter layer ikut terbakar ke hasil ekspor.
    applyKonvaImageFilter(node, l.filter)
    return node
  }

  if (l.type === 'text') {
    // Rich text (styleRanges) atau warna per-baris (prosa `*`): layout custom
    // sama seperti node editor.
    if ((l.styleRanges && l.styleRanges.length > 0) || hasMixedAutoPurple(l.text)) {
      const layout = layoutRichText(l, l.styleRanges ?? [])
      return new Konva.Shape({
        ...common,
        width: layout.width,
        height: layout.height,
        selfRectFunc: () => ({ x: 0, y: 0, width: layout.width, height: layout.height }),
        sceneFunc: (ctx) => {
          drawRichRuns(ctx._context, layout, {
            stroke: l.stroke,
            strokeWidth: l.strokeWidth,
            letterSpacing: l.letterSpacing,
          })
        },
        shadowColor: l.shadowBlur > 0 ? l.shadowColor : undefined,
        shadowBlur: l.shadowBlur || undefined,
        shadowOffsetX: l.shadowOffsetX || undefined,
        shadowOffsetY: l.shadowOffsetY || undefined,
      })
    }
    // Teks berukuran otomatis (ikut konten, tanpa word-wrap): jangan kirim
    // width/height — `undefined` menghapus attr sehingga Konva.Text mode auto.
    return new Konva.Text({
      ...common,
      width: undefined,
      height: undefined,
      text: l.text,
      fontFamily: l.fontFamily,
      fontSize: l.fontSize,
      fontStyle: l.fontStyle === 'italic' ? `italic ${l.fontWeight}` : `${l.fontWeight}`,
      fill: l.fill,
      align: l.align,
      lineHeight: l.lineHeight,
      letterSpacing: l.letterSpacing,
      stroke: l.stroke || undefined,
      strokeWidth: l.strokeWidth || undefined,
      fillAfterStrokeEnabled: !!l.strokeWidth,
      shadowColor: l.shadowBlur > 0 ? l.shadowColor : undefined,
      shadowBlur: l.shadowBlur || undefined,
      shadowOffsetX: l.shadowOffsetX || undefined,
      shadowOffsetY: l.shadowOffsetY || undefined,
    })
  }

  return new Konva.Rect({
    ...common,
    fill: l.fill,
    cornerRadius: l.cornerRadius,
    stroke: l.stroke || undefined,
    strokeWidth: l.strokeWidth || undefined,
  })
}

/**
 * Per-asset export: the cropped image plus THIS image's text/shape layers,
 * composited at the crop output resolution. Overlay coordinates are mapped
 * from canvas space onto the image layer's box, so text sits exactly where
 * the editor shows it. Anything past the output edge is cut off.
 */
async function renderAssetComposite(
  document: EditorDocument,
  imageLayer: Extract<Layer, { type: 'image' }>,
  crop: CropRule,
): Promise<HTMLCanvasElement> {
  const asset = document.assets[imageLayer.assetId]
  if (!asset) throw new Error(`Missing asset for layer ${imageLayer.id}`)
  const base = await renderAssetExport({ asset, crop })
  const overlays = document.layers.filter(
    (l) =>
      l.visible &&
      layerVisibleForAsset(l, imageLayer.assetId) &&
      // Gambar induk tidak jadi overlay; gambar tempelan (ownerAssetId) ikut dirender.
      !(l.type === 'image' && !l.ownerAssetId),
  )
  if (overlays.length === 0) return base

  const container = window.document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.pointerEvents = 'none'
  window.document.body.appendChild(container)

  const stage = new Konva.Stage({
    container,
    width: base.width,
    height: base.height,
  })
  try {
    const layer = new Konva.Layer()
    stage.add(layer)
    const baseNode = new Konva.Image({
      image: base,
      x: 0,
      y: 0,
      width: base.width,
      height: base.height,
      listening: false,
    })
    // Filter milik layer induk juga diterapkan pada ekspor per-aset.
    applyKonvaImageFilter(baseNode, imageLayer.filter)
    layer.add(baseNode)
    // Map canvas coordinates onto the image layer's box: layer-local point
    // (x, y) lands at ((x - box.x) * sx, (y - box.y) * sy) in output space.
    const group = new Konva.Group({
      scaleX: base.width / Math.max(1, imageLayer.width),
      scaleY: base.height / Math.max(1, imageLayer.height),
      offsetX: imageLayer.x,
      offsetY: imageLayer.y,
      listening: false,
    })
    for (const l of overlays) {
      const node = await buildNode(l, document)
      if (node) group.add(node)
    }
    layer.add(group)
    return stage.toCanvas()
  } finally {
    stage.destroy()
    container.remove()
  }
}

/** Produce the full set of files for an export, honoring the chosen mode. */
export async function buildExportFiles(
  document: EditorDocument,
  options: ExportOptions,
): Promise<ExportFile[]> {
  if (options.mode === 'canvas') {
    const canvas = await renderDocumentToCanvas(
      document,
      options.scale,
      options.activeAssetId ?? null,
    )
    const blob = await canvasToBlob(canvas, options.format, options.quality, options.background)
    return [{ name: exportFileName(options.prefix, null, options.format), blob }]
  }

  const files: ExportFile[] = []
  const imageLayers = document.layers.filter(
    (l): l is Extract<Layer, { type: 'image' }> =>
      // Overlay bukan screenshot tersendiri — ia dirender menimpa induknya.
      l.type === 'image' && l.visible && !l.ownerAssetId,
  )
  let index = 1
  for (const layer of imageLayers) {
    const asset = document.assets[layer.assetId]
    if (!asset) continue
    const crop = effectiveCrop(layer, document) ?? defaultCropRule(asset.width, asset.height)
    const canvas = await renderAssetComposite(document, layer, crop)
    const blob = await canvasToBlob(canvas, options.format, options.quality, options.background)
    files.push({ name: exportFileName(options.prefix, index, options.format), blob })
    index += 1
  }
  if (files.length === 0) throw new Error('No image assets to export')
  return files
}

/** Bundle files into a ZIP (uncompressed entry order preserved). */
export async function makeZip(files: ExportFile[]): Promise<Blob> {
  const zip = new JSZip()
  for (const f of files) zip.file(f.name, f.blob)
  return zip.generateAsync({ type: 'blob' })
}

export function downloadFiles(files: ExportFile[], zipName?: string): void {
  if (files.length === 1 && files[0]) {
    downloadBlob(files[0].blob, files[0].name)
    return
  }
  void makeZip(files).then((zip) =>
    downloadBlob(zip, `${(zipName ?? 'ssrp-export').replace(/\.zip$/i, '')}.zip`),
  )
}

export interface PublishedFile {
  name: string
  url: string
}

/**
 * Upload exported files to the public `published` bucket and return their
 * public URLs. Bucket RLS restricts writes to users/{uid}/...; reads are
 * public by bucket design.
 */
export async function publishFiles(
  projectId: string,
  files: ExportFile[],
): Promise<PublishedFile[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const folder = `${Date.now()}-${nanoid(6)}`
  const results: PublishedFile[] = []
  for (const file of files) {
    const key = `users/${user.id}/projects/${projectId}/${folder}/${file.name}`
    const { error } = await supabase.storage.from(PUBLISH_BUCKET).upload(key, file.blob, {
      contentType: file.blob.type || 'image/png',
      upsert: false,
    })
    if (error) throw new Error(error.message)
    const { data } = supabase.storage.from(PUBLISH_BUCKET).getPublicUrl(key)
    results.push({ name: file.name, url: data.publicUrl })
  }
  return results
}

export interface PublishSnippets {
  urls: string
  bbcode: string
  markdown: string
  html: string
}

/** Forum-ready snippets for a set of published URLs. */
export function buildSnippets(published: PublishedFile[]): PublishSnippets {
  const urls = published.map((p) => p.url).join('\n')
  const bbcode = published.map((p) => `[img]${p.url}[/img]`).join('\n')
  const markdown = published
    .map((p) => `![${p.name.replace(/\.[^.]+$/, '')}](${p.url})`)
    .join('\n')
  const html = published
    .map((p) => `<img src="${p.url}" alt="${p.name.replace(/\.[^.]+$/, '')}">`)
    .join('\n')
  return { urls, bbcode, markdown, html }
}
