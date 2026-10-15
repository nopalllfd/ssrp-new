import { z } from 'zod'
import {
  EDITOR_SCHEMA_VERSION,
  type CropRule,
  type EditorDocument,
  type ImageLayer,
  type Layer,
} from '@/types/editor'

const normalizedCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
})

const cropRuleSchema = z.object({
  region: normalizedCropSchema,
  outWidth: z.number().int().positive(),
  outHeight: z.number().int().positive(),
  fit: z.enum(['crop', 'fit']),
  padColor: z.string(),
})

const baseLayer = {
  id: z.string().min(1),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
}

const imageFilterSchema = z.object({
  brightness: z.number().min(-1).max(1),
  contrast: z.number().min(-100).max(100),
  saturate: z.number().min(-1).max(1),
  hue: z.number().min(-180).max(180),
  blur: z.number().min(0).max(40),
  noise: z.number().min(0).max(1),
  grayscale: z.number().min(0).max(1),
  sepia: z.number().min(0).max(1),
})

const imageLayerSchema = z.object({
  ...baseLayer,
  type: z.literal('image'),
  assetId: z.string().min(1),
  // Opsional agar dokumen lama tanpa field ini tetap valid.
  ownerAssetId: z.string().min(1).nullable().optional(),
  cropOverride: cropRuleSchema.nullable(),
  // Opsional — dokumen lama tanpa filter tetap valid.
  filter: imageFilterSchema.nullable().optional(),
})

const styleRangeSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  fontFamily: z.string().optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z
    .union([z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)])
    .optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  fill: z.string().optional(),
})

const textLayerSchema = z.object({
  ...baseLayer,
  type: z.literal('text'),
  assetId: z.string().min(1).nullable(),
  text: z.string(),
  fontFamily: z.string(),
  fontSize: z.number().positive(),
  fontStyle: z.enum(['normal', 'italic']),
  fontWeight: z.union([
    z.literal(400),
    z.literal(500),
    z.literal(600),
    z.literal(700),
    z.literal(800),
  ]),
  fill: z.string(),
  styleRanges: z.array(styleRangeSchema).optional(),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().positive(),
  letterSpacing: z.number(),
  stroke: z.string(),
  strokeWidth: z.number().min(0),
  shadowColor: z.string(),
  shadowBlur: z.number().min(0),
  shadowOffsetX: z.number(),
  shadowOffsetY: z.number(),
  chatlogMargin: z.number().min(0).optional(),
})

const rectLayerSchema = z.object({
  ...baseLayer,
  type: z.literal('rect'),
  assetId: z.string().min(1).nullable(),
  fill: z.string(),
  cornerRadius: z.number().min(0),
  stroke: z.string(),
  strokeWidth: z.number().min(0),
})

const layerSchema = z.discriminatedUnion('type', [
  imageLayerSchema,
  textLayerSchema,
  rectLayerSchema,
])

const assetRefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fileSize: z.number().nonnegative(),
  checksum: z.string(),
  objectKey: z.string().nullable(),
  status: z.enum(['local', 'queued', 'uploading', 'ready', 'error']),
  uploadProgress: z.number().min(0).max(100),
  error: z.string().nullable(),
})

const exportDefaultsSchema = z.object({
  format: z.enum(['png', 'jpeg', 'webp']),
  quality: z.number().min(0.1).max(1),
  prefix: z.string(),
  scale: z.number().positive(),
  background: z.string(),
})

const documentSchema = z.object({
  schemaVersion: z.number().int().positive(),
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    background: z.string(),
  }),
  layers: z.array(layerSchema),
  assets: z.record(z.string(), assetRefSchema),
  applySameCropToAll: z.boolean(),
  sharedCrop: cropRuleSchema.nullable(),
  exportDefaults: exportDefaultsSchema,
})

export function createEmptyDocument(): EditorDocument {
  return {
    schemaVersion: EDITOR_SCHEMA_VERSION,
    canvas: { width: 1280, height: 720, background: '#111111' },
    layers: [],
    assets: {},
    applySameCropToAll: true,
    sharedCrop: null,
    exportDefaults: {
      format: 'png',
      quality: 0.92,
      prefix: 'ssrp',
      scale: 1,
      background: '#000000',
    },
  }
}

export function defaultCropRule(outWidth = 1280, outHeight = 720): CropRule {
  return {
    region: { x: 0, y: 0, w: 1, h: 1 },
    outWidth,
    outHeight,
    fit: 'crop',
    padColor: '#000000',
  }
}

/**
 * Migrate older serialized documents forward. Currently a single schema
 * version exists; new versions append a step here.
 */
export function migrateDocument(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const doc = raw as Record<string, unknown>
  if (doc.schemaVersion === undefined) {
    doc.schemaVersion = EDITOR_SCHEMA_VERSION
  }
  // Text/rect layers gained an `assetId` scope. Legacy documents lack the
  // field — default to null (unscoped, shown on every image).
  if (Array.isArray(doc.layers)) {
    for (const layer of doc.layers) {
      if (typeof layer !== 'object' || layer === null) continue
      const l = layer as Record<string, unknown>
      if ((l.type === 'text' || l.type === 'rect') && l.assetId === undefined) {
        l.assetId = null
      }
      // Clamp styleRanges warisan ke panjang text; buang yang kosong/invalid.
      if (l.type === 'text' && Array.isArray(l.styleRanges)) {
        const textLength = typeof l.text === 'string' ? l.text.length : 0
        l.styleRanges = (l.styleRanges as Array<Record<string, unknown>>)
          .map((r) => ({
            ...r,
            start: Math.max(0, Math.min(Number(r.start) || 0, textLength)),
            end: Math.max(0, Math.min(Number(r.end) || 0, textLength)),
          }))
          .filter((r) => (r.end as number) > (r.start as number))
        if ((l.styleRanges as unknown[]).length === 0) delete l.styleRanges
      }
    }
  }
  return doc
}

export type DocumentValidation =
  | { ok: true; document: EditorDocument }
  | { ok: false; error: string }

export function parseDocument(raw: unknown): DocumentValidation {
  const migrated = migrateDocument(raw)
  const result = documentSchema.safeParse(migrated)
  if (!result.success) {
    const first = result.error.issues[0]
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid document',
    }
  }
  return { ok: true, document: result.data as EditorDocument }
}

/** Clamp a normalized crop so it stays a valid region inside the source image. */
export function clampCropRegion(region: CropRule['region']): CropRule['region'] {
  const x = Math.min(Math.max(region.x, 0), 1)
  const y = Math.min(Math.max(region.y, 0), 1)
  const w = Math.min(Math.max(region.w, 0.01), 1 - x)
  const h = Math.min(Math.max(region.h, 0.01), 1 - y)
  return { x, y, w, h }
}

export function getLayerById(layers: Layer[], id: string): Layer | undefined {
  return layers.find((l) => l.id === id)
}

/**
 * Whether a layer should render for the given active image.
 * Image layers match their own asset (or, for overlays, the owning asset);
 * text/rect layers match the owning asset, while `assetId: null` layers
 * are unscoped (legacy) and show on every image.
 */
export function layerVisibleForAsset(layer: Layer, activeAssetId: string | null): boolean {
  // Gambar induk tampil pada asetnya sendiri; gambar overlay (ownerAssetId)
  // tampil menimpa aset induknya.
  if (layer.type === 'image') return (layer.ownerAssetId ?? layer.assetId) === activeAssetId
  if (layer.assetId === null) return true
  return layer.assetId === activeAssetId
}

/** Layers that belong to the given active image, in document order. */
export function layersForAsset(layers: Layer[], activeAssetId: string | null): Layer[] {
  return layers.filter((l) => layerVisibleForAsset(l, activeAssetId))
}

/** Effective crop rule for an image layer: override wins, otherwise shared. */
export function effectiveCrop(layer: Layer, document: EditorDocument): CropRule | null {
  if (layer.type !== 'image') return null
  if (layer.cropOverride) return layer.cropOverride
  // Overlay tidak mewarisi crop bersama — tampil utuh apa adanya.
  if (layer.ownerAssetId) return null
  if (document.applySameCropToAll) return document.sharedCrop
  return null
}

function fitLayerToAspect(layer: ImageLayer, aspect: number) {
  const current = layer.width / layer.height
  if (!Number.isFinite(current) || Math.abs(current - aspect) < 1e-6) return
  if (aspect > current) {
    layer.height = Math.max(5, layer.width / aspect)
  } else {
    layer.width = Math.max(5, layer.height * aspect)
  }
}

/**
 * Fit every image layer's box to its effective crop region aspect so the
 * canvas shows a real crop instead of stretching the image into the box.
 * Ukuran layer TIDAK dipaksa masuk ke dalam canvas — canvas hanya
 * memotong (clip) bagian yang menonjol. Mutates in place.
 */
export function refitImageLayers(document: EditorDocument) {
  for (const layer of document.layers) {
    if (layer.type !== 'image') continue
    const asset = document.assets[layer.assetId]
    if (!asset) continue
    const crop = effectiveCrop(layer, document)
    const aspect = crop
      ? (crop.region.w * asset.width) / Math.max(1e-9, crop.region.h * asset.height)
      : asset.width / Math.max(1, asset.height)
    fitLayerToAspect(layer, aspect)
  }
}
