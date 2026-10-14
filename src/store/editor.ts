import { create } from 'zustand'
import { nanoid } from 'nanoid'
import {
  EDITOR_SCHEMA_VERSION,
  type CropRule,
  type EditorDocument,
  type Layer,
  type SyncStatus,
  type TextLayer,
} from '@/types/editor'
import { createEmptyDocument, layerVisibleForAsset } from '@/lib/editorDocument'
import { AUTO_PURPLE } from '@/lib/richText'

export { AUTO_PURPLE }

const HISTORY_LIMIT = 100

export interface EditorState {
  document: EditorDocument
  selection: string[]
  zoom: number
  stagePos: { x: number; y: number }
  dirty: boolean
  syncStatus: SyncStatus
  revision: number | null
  past: EditorDocument[]
  future: EditorDocument[]
  // Id asset gambar yang sedang ditampilkan di canvas (single-image mode).
  activeAssetId: string | null
  // Seleksi teks aktif di editor inline (textarea). Dipakai PropertiesPanel
  // untuk menerapkan gaya hanya ke rangkaian [start, end) yang diseleksi.
  textSelection: { layerId: string; start: number; end: number } | null

  // document lifecycle
  loadDocument: (doc: EditorDocument, revision: number | null) => void
  resetDocument: () => void

  // history-aware mutation entry point
  mutate: (fn: (doc: EditorDocument) => void, options?: { coalesce?: boolean }) => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  // selection / view
  setSelection: (ids: string[]) => void
  addToSelection: (id: string) => void
  setZoom: (zoom: number) => void
  setStagePos: (pos: { x: number; y: number }) => void
  setActiveAsset: (id: string | null) => void
  setTextSelection: (sel: { layerId: string; start: number; end: number } | null) => void

  // sync
  setDirty: (dirty: boolean) => void
  setSyncStatus: (s: SyncStatus) => void
  setRevision: (rev: number | null) => void
}

function cloneDocument(doc: EditorDocument): EditorDocument {
  return structuredClone(doc)
}

function firstImageAssetId(doc: EditorDocument): string | null {
  const layer = doc.layers.find((l) => l.type === 'image' && l.visible)
  return layer && layer.type === 'image' ? layer.assetId : null
}

/**
 * Layer text/shape tanpa pemilik (assetId null — dokumen lama atau dibuat
 * sebelum ada gambar) "diserap" oleh gambar aktif supaya tiap layer benar-benar
 * unik per gambar dan tidak nongol di semua gambar.
 */
function claimUnscopedLayers(doc: EditorDocument, assetId: string | null): boolean {
  if (!assetId) return false
  let changed = false
  for (const layer of doc.layers) {
    if (layer.type !== 'image' && layer.assetId === null) {
      layer.assetId = assetId
      changed = true
    }
  }
  return changed
}

export const DEFAULT_TEXT_FILL = '#ffffff'

function startsWithAsterisk(text: string): boolean {
  return text.trimStart().startsWith('*')
}

/**
 * Warna dasar efektif sebuah isi text setelah aturan auto-purple:
 * - semua baris diawali `*` → ungu penuh;
 * - campuran prosa `*` + baris biasa → fill sekarang, kecuali masih ungu
 *   (sisa aturan lama) yang di-reset ke putih agar baris dialog tidak ungu;
 * - tanpa `*` → fill tidak berubah.
 * Baris `*` pada teks campuran tetap tampil ungu via renderer per-baris.
 */
export function resolveAutoTextFill(text: string, currentFill: string): string {
  if (!startsWithAsterisk(text)) return currentFill
  const hasPlainLine = text
    .split('\n')
    .some((line) => line.trim() !== '' && !startsWithAsterisk(line))
  if (!hasPlainLine) return AUTO_PURPLE
  return currentFill.toLowerCase() === AUTO_PURPLE ? DEFAULT_TEXT_FILL : currentFill
}

/** Text lines that start with `*` are roleplay prose — auto-color them purple. */
export function applyAutoTextColors(doc: EditorDocument) {
  for (const layer of doc.layers) {
    if (layer.type === 'text') layer.fill = resolveAutoTextFill(layer.text, layer.fill)
  }
}

/**
 * Salin seluruh gaya text `src` ke SEMUA layer text di dokumen (semua gambar).
 * Warna ungu prosa `*` bersifat turunan dari isi text, bukan pilihan user,
 * jadi dievaluasi ulang per-target: text `*` tetap ungu, text lain pakai
 * warna dasar. Ungu yang dipilih manual (bukan hasil auto) disalin apa adanya.
 */
export function applyTextStyleToAllImages(doc: EditorDocument, src: TextLayer): void {
  const srcAutoPurple =
    startsWithAsterisk(src.text) && src.fill.toLowerCase() === AUTO_PURPLE
  for (const layer of doc.layers) {
    if (layer.type !== 'text') continue
    layer.fontFamily = src.fontFamily
    layer.fontSize = src.fontSize
    layer.fontWeight = src.fontWeight
    layer.fontStyle = src.fontStyle
    layer.fill = srcAutoPurple
      ? resolveAutoTextFill(layer.text, DEFAULT_TEXT_FILL)
      : src.fill
    layer.lineHeight = src.lineHeight
    layer.letterSpacing = src.letterSpacing
    layer.stroke = src.stroke
    layer.strokeWidth = src.strokeWidth
    layer.shadowColor = src.shadowColor
    layer.shadowBlur = src.shadowBlur
    layer.shadowOffsetX = src.shadowOffsetX
    layer.shadowOffsetY = src.shadowOffsetY
    // Hapus gaya per-rangkaian agar hasil benar-benar seragam.
    delete layer.styleRanges
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  document: createEmptyDocument(),
  selection: [],
  zoom: 1,
  stagePos: { x: 0, y: 0 },
  dirty: false,
  syncStatus: 'synced',
  revision: null,
  past: [],
  future: [],
  activeAssetId: null,
  textSelection: null,

  loadDocument: (doc, revision) => {
    const loaded = cloneDocument(doc)
    applyAutoTextColors(loaded)
    // Layer lama tanpa pemilik jadi milik gambar pertama, bukan tampil di semua.
    claimUnscopedLayers(loaded, firstImageAssetId(loaded))
    set({
      document: loaded,
      revision,
      selection: [],
      past: [],
      future: [],
      dirty: false,
      syncStatus: 'synced',
      zoom: 1,
      stagePos: { x: 0, y: 0 },
      activeAssetId: firstImageAssetId(loaded),
      textSelection: null,
    })
  },

  resetDocument: () =>
    set({
      document: createEmptyDocument(),
      selection: [],
      past: [],
      future: [],
      dirty: false,
      revision: null,
      syncStatus: 'synced',
      activeAssetId: null,
      textSelection: null,
    }),

  mutate: (fn, options) => {
    const { document, past, dirty } = get()
    const next = cloneDocument(document)
    fn(next)
    applyAutoTextColors(next)
    // Direct mutations go through this funnel so undo stays coherent. Callers
    // can coalesce high-frequency drags (sliders, transformer) into one
    // history entry by passing { coalesce: true } on consecutive calls.
    const coalescable = options?.coalesce && dirty
    set({
      document: next,
      dirty: true,
      syncStatus: 'unsaved',
      past: coalescable ? past : [...past.slice(-HISTORY_LIMIT + 1), document],
      future: [],
    })
  },

  undo: () => {
    const { past, future, document } = get()
    const prev = past[past.length - 1]
    if (!prev) return
    set({
      document: prev,
      past: past.slice(0, -1),
      future: [document, ...future],
      dirty: true,
      syncStatus: 'unsaved',
    })
  },

  redo: () => {
    const { past, future, document } = get()
    const next = future[0]
    if (!next) return
    set({
      document: next,
      past: [...past, document],
      future: future.slice(1),
      dirty: true,
      syncStatus: 'unsaved',
    })
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  setSelection: (ids) => set({ selection: ids }),
  addToSelection: (id) =>
    set((s) => ({
      selection: s.selection.includes(id) ? s.selection : [...s.selection, id],
    })),
  setZoom: (zoom) => set({ zoom: Math.min(Math.max(zoom, 0.05), 8) }),
  setStagePos: (pos) => set({ stagePos: pos }),
  setTextSelection: (sel) => set({ textSelection: sel }),
  setActiveAsset: (id) => {
    // Serap layer tanpa pemilik (mis. dibuat sebelum ada gambar) oleh gambar
    // yang baru diaktifkan — tanpa menambah entri history.
    const { document, selection } = get()
    const next = cloneDocument(document)
    const claimed = claimUnscopedLayers(next, id)
    // Buang seleksi layer yang tidak terlihat di gambar baru supaya panel
    // properti tidak mengedit layer yang sedang tersembunyi.
    const kept = selection.filter((selId) => {
      const layer = next.layers.find((l) => l.id === selId)
      return layer ? layerVisibleForAsset(layer, id) : false
    })
    const selectionChanged = kept.length !== selection.length
    if (claimed || selectionChanged) {
      set({ activeAssetId: id, document: next, selection: kept })
    } else {
      set({ activeAssetId: id })
    }
  },

  setDirty: (dirty) => set({ dirty }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setRevision: (revision) => set({ revision }),
}))

// ---------------------------------------------------------- layer helpers

export function newTextLayer(partial: Partial<Extract<Layer, { type: 'text' }>> = {}): Layer {
  return {
    id: nanoid(),
    type: 'text',
    assetId: null,
    name: partial.name ?? 'Text',
    x: 100,
    y: 100,
    // 0 = auto: ukuran mengikuti konten teks (tanpa word-wrap).
    width: 0,
    height: 0,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text: 'Double-click to edit',
    fontFamily: 'Arial',
    fontSize: 32,
    fontStyle: 'normal',
    fontWeight: 700,
    fill: DEFAULT_TEXT_FILL,
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    stroke: '',
    strokeWidth: 0,
    shadowColor: 'rgba(0,0,0,0.6)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    ...partial,
  } as Extract<Layer, { type: 'text' }>
}

export function newRectLayer(partial: Partial<Extract<Layer, { type: 'rect' }>> = {}): Layer {
  return {
    id: nanoid(),
    type: 'rect',
    assetId: null,
    name: partial.name ?? 'Rectangle',
    x: 100,
    y: 100,
    width: 240,
    height: 240,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: '#4f46e5',
    cornerRadius: 0,
    stroke: '',
    strokeWidth: 0,
    ...partial,
  } as Extract<Layer, { type: 'rect' }>
}

export function newImageLayer(input: {
  assetId: string
  width: number
  height: number
  x?: number
  y?: number
  name?: string
  /** Terisi bila layer ini overlay yang menimpa gambar aktif lain. */
  ownerAssetId?: string | null
  /** Dipakai overlay supaya gambar tampil utuh (tidak mewarisi crop bersama). */
  cropOverride?: CropRule | null
}): Layer {
  return {
    id: nanoid(),
    type: 'image',
    name: input.name ?? 'Image',
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width,
    height: input.height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    assetId: input.assetId,
    ownerAssetId: input.ownerAssetId ?? null,
    cropOverride: input.cropOverride ?? null,
  }
}

export function duplicateLayer(layer: Layer): Layer {
  const copy = structuredClone(layer)
  copy.id = nanoid()
  copy.name = `${layer.name} copy`
  copy.x = layer.x + 20
  copy.y = layer.y + 20
  return copy
}

export function buildSchemaVersionedDocument(partial: Partial<EditorDocument>): EditorDocument {
  return {
    ...createEmptyDocument(),
    ...partial,
    schemaVersion: EDITOR_SCHEMA_VERSION,
  }
}

export type { CropRule }
