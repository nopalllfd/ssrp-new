/**
 * Editor document model.
 *
 * The document is the single source of truth for a project. It is serialized
 * to JSONB in `project_states.document`. Konva nodes are derived from it —
 * never the other way around.
 */

export const EDITOR_SCHEMA_VERSION = 1

/** Normalized crop rectangle, all values relative to the source image (0..1). */
export interface NormalizedCrop {
  x: number
  y: number
  w: number
  h: number
}

export type CropFit = 'crop' | 'fit'

/**
 * Crop rule applied to an image.
 *
 * - `region` selects a normalized source rectangle.
 * - `outWidth`/`outHeight` are the intended output resolution in px.
 * - `fit: 'crop'` scales the region to fill the output, cropping overflow.
 * - `fit: 'fit'` scales the region to fit inside the output, padding with
 *   `padColor` when aspect ratios differ.
 *
 * Normalized coordinates make the same rule portable across images with
 * different source dimensions.
 */
export interface CropRule {
  region: NormalizedCrop
  outWidth: number
  outHeight: number
  fit: CropFit
  padColor: string
}

interface BaseLayer {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
}

/**
 * Penyesuaian visual non-destruktif untuk satu layer gambar.
 * Semua nilai netral = 0 (kecuali yang berbasis 0..1), sehingga filter
 * default identik dengan gambar aslinya.
 */
export interface ImageFilter {
  /** Kecerahan: -1 (gelap total) .. 1 (terang total). */
  brightness: number
  /** Kontras: -100 .. 100. */
  contrast: number
  /** Saturasi warna: -1 (hitam putih) .. 1 (super jenuh). */
  saturate: number
  /** Rotasi hue dalam derajat: -180 .. 180. */
  hue: number
  /** Radius blur piksel: 0 .. 40. */
  blur: number
  /** Intensitas bintik/noise: 0 .. 1. */
  noise: number
  /** Campuran hitam-putih: 0 .. 1. */
  grayscale: number
  /** Campuran sepia: 0 .. 1. */
  sepia: number
}

export interface ImageLayer extends BaseLayer {
  type: 'image'
  assetId: string
  /**
   * Bila terisi, layer ini adalah gambar tempelan (overlay) yang menimpa
   * aset induk `ownerAssetId` — bukan screenshot tersendiri.
   */
  ownerAssetId?: string | null
  /** Per-image crop override. Null = inherit the shared crop rule. */
  cropOverride: CropRule | null
  /** Filter penyesuaian gambar. Null/absen = tanpa filter. */
  filter?: ImageFilter | null
}

/** Partial gaya text untuk satu rangkaian karakter (rich text). */
export interface TextStyleOverride {
  fontFamily?: string
  fontSize?: number
  fontWeight?: 400 | 500 | 600 | 700 | 800
  fontStyle?: 'normal' | 'italic'
  fill?: string
}

/** Override gaya untuk karakter [start, end) di dalam TextLayer.text. */
export interface TextStyleRange extends TextStyleOverride {
  start: number
  end: number
}

export interface TextLayer extends BaseLayer {
  type: 'text'
  /** Image this layer belongs to. Null = created without an active image (legacy docs). */
  assetId: string | null
  text: string
  fontFamily: string
  fontSize: number
  fontStyle: 'normal' | 'italic'
  fontWeight: 400 | 500 | 600 | 700 | 800
  fill: string
  /** Gaya per-rangkaian karakter; kosong/absen = text satu gaya (fast path). */
  styleRanges?: TextStyleRange[]
  align: 'left' | 'center' | 'right'
  lineHeight: number
  letterSpacing: number
  stroke: string
  strokeWidth: number
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
}

export interface RectLayer extends BaseLayer {
  type: 'rect'
  /** Image this layer belongs to. Null = created without an active image (legacy docs). */
  assetId: string | null
  fill: string
  cornerRadius: number
  stroke: string
  strokeWidth: number
}

export type Layer = ImageLayer | TextLayer | RectLayer

export interface AssetRef {
  id: string
  name: string
  mimeType: string
  width: number
  height: number
  fileSize: number
  checksum: string
  /** Supabase Storage object key. Null while the file only exists locally. */
  objectKey: string | null
  status: 'local' | 'queued' | 'uploading' | 'ready' | 'error'
  uploadProgress: number
  error: string | null
}

export interface ExportDefaults {
  format: 'png' | 'jpeg' | 'webp'
  quality: number
  prefix: string
  /** Output scale multiplier applied to canvas-size exports. */
  scale: number
  background: string
}

export interface EditorDocument {
  schemaVersion: number
  canvas: {
    width: number
    height: number
    background: string
  }
  /** Bottom-to-top layer order. */
  layers: Layer[]
  assets: Record<string, AssetRef>
  /** When true, every image without an override uses `sharedCrop`. */
  applySameCropToAll: boolean
  sharedCrop: CropRule | null
  exportDefaults: ExportDefaults
}

export type SyncStatus =
  | 'synced'
  | 'local'
  | 'autosaving'
  | 'saving'
  | 'uploading'
  | 'unsaved'
  | 'save-failed'
  | 'upload-failed'
  | 'conflict'
