import { describe, expect, it } from 'vitest'
import {
  clampCropRegion,
  createEmptyDocument,
  defaultCropRule,
  effectiveCrop,
  layerVisibleForAsset,
  layersForAsset,
  migrateDocument,
  parseDocument,
} from '@/lib/editorDocument'
import { EDITOR_SCHEMA_VERSION, type EditorDocument } from '@/types/editor'
import { DEFAULT_IMAGE_FILTER, isNeutralFilter } from '@/lib/imageFilters'
import { newImageLayer, newTextLayer } from '@/store/editor'

describe('createEmptyDocument', () => {
  it('produces a schema-valid document', () => {
    const result = parseDocument(createEmptyDocument())
    expect(result.ok).toBe(true)
  })

  it('uses the current schema version and 1280x720 canvas', () => {
    const doc = createEmptyDocument()
    expect(doc.schemaVersion).toBe(EDITOR_SCHEMA_VERSION)
    expect(doc.canvas).toEqual({ width: 1280, height: 720, background: '#111111' })
  })
})

describe('parseDocument', () => {
  it('rejects non-objects', () => {
    expect(parseDocument(null).ok).toBe(false)
    expect(parseDocument('nope').ok).toBe(false)
    expect(parseDocument(42).ok).toBe(false)
  })

  it('rejects a document missing required sections', () => {
    const result = parseDocument({ schemaVersion: 1, layers: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })

  it('rejects an invalid layer type', () => {
    const doc = createEmptyDocument()
    const bad = { ...doc, layers: [{ id: 'x', type: 'circle' }] }
    expect(parseDocument(bad).ok).toBe(false)
  })

  it('accepts documents with factory-made layers', () => {
    const doc = createEmptyDocument()
    doc.layers.push(newTextLayer(), newImageLayer({ assetId: 'a1', width: 800, height: 600 }))
    doc.assets['a1'] = {
      id: 'a1',
      name: 'shot.png',
      mimeType: 'image/png',
      width: 800,
      height: 600,
      fileSize: 1000,
      checksum: 'abc',
      objectKey: null,
      status: 'local',
      uploadProgress: 0,
      error: null,
    }
    expect(parseDocument(doc).ok).toBe(true)
  })

  it('accepts an image layer carrying a valid filter, and rejects out-of-range values', () => {
    const doc = createEmptyDocument()
    const layer = newImageLayer({ assetId: 'a1', width: 800, height: 600 })
    if (layer.type !== 'image') throw new Error('expected image layer')
    layer.filter = {
      brightness: 0.4,
      contrast: 25,
      saturate: -0.2,
      hue: 90,
      blur: 6,
      noise: 0.3,
      grayscale: 0.5,
      sepia: 1,
    }
    doc.layers.push(layer)
    expect(parseDocument(doc).ok).toBe(true)

    // Dokumen lama tanpa field filter tetap valid.
    delete layer.filter
    expect(parseDocument(doc).ok).toBe(true)

    // Nilai di luar rentang skema ditolak.
    layer.filter = {
      brightness: 2,
      contrast: 0,
      saturate: 0,
      hue: 0,
      blur: 0,
      noise: 0,
      grayscale: 0,
      sepia: 0,
    }
    expect(parseDocument(doc).ok).toBe(false)
  })

  it('detects neutral image filters', () => {
    expect(isNeutralFilter(null)).toBe(true)
    expect(isNeutralFilter(undefined)).toBe(true)
    expect(isNeutralFilter({ ...DEFAULT_IMAGE_FILTER })).toBe(true)
    expect(isNeutralFilter({ ...DEFAULT_IMAGE_FILTER, blur: 2 })).toBe(false)
    expect(isNeutralFilter({ ...DEFAULT_IMAGE_FILTER, grayscale: 0.5 })).toBe(false)
  })
})

describe('migrateDocument', () => {
  it('fills a missing schemaVersion', () => {
    const input: Record<string, unknown> = { layers: [] }
    const out = migrateDocument(input) as Record<string, unknown>
    expect(out.schemaVersion).toBe(EDITOR_SCHEMA_VERSION)
  })

  it('leaves primitives untouched', () => {
    expect(migrateDocument(null)).toBeNull()
    expect(migrateDocument('x')).toBe('x')
  })

  it('gives legacy text/rect layers a null assetId so old docs stay valid', () => {
    const doc = createEmptyDocument()
    const legacyText = { ...(newTextLayer() as unknown as Record<string, unknown>) }
    delete legacyText.assetId
    const layers = [legacyText]
    const out = migrateDocument({ schemaVersion: 1, layers }) as {
      layers: Array<Record<string, unknown>>
    }
    expect(out.layers[0]?.assetId).toBeNull()
    // And a full legacy document (text layer without assetId) still parses.
    const legacy = { ...structuredClone(doc), layers: [legacyText] }
    const result = parseDocument(legacy)
    expect(result.ok).toBe(true)
    if (result.ok && result.document.layers[0]?.type === 'text') {
      expect(result.document.layers[0].assetId).toBeNull()
    }
  })
})

describe('layerVisibleForAsset (per-image layer scope)', () => {
  const img = (assetId: string) => newImageLayer({ assetId, width: 100, height: 100 })

  it('shows an image layer only for its own asset', () => {
    const a = img('a1')
    expect(layerVisibleForAsset(a, 'a1')).toBe(true)
    expect(layerVisibleForAsset(a, 'a2')).toBe(false)
    expect(layerVisibleForAsset(a, null)).toBe(false)
  })

  it('shows scoped text only on the owning image', () => {
    const t = newTextLayer({ assetId: 'a1' })
    expect(layerVisibleForAsset(t, 'a1')).toBe(true)
    expect(layerVisibleForAsset(t, 'a2')).toBe(false)
    expect(layerVisibleForAsset(t, null)).toBe(false)
  })

  it('treats null-assetId text as unscoped (visible on every image)', () => {
    const t = newTextLayer()
    expect(layerVisibleForAsset(t, 'a1')).toBe(true)
    expect(layerVisibleForAsset(t, 'a2')).toBe(true)
    expect(layerVisibleForAsset(t, null)).toBe(true)
  })

  it('layersForAsset keeps only what the active image renders', () => {
    const layers = [
      img('a1'),
      newTextLayer({ assetId: 'a1' }),
      newTextLayer({ assetId: 'a2' }),
      newTextLayer(),
    ]
    const scoped = layersForAsset(layers, 'a1')
    expect(scoped).toHaveLength(3)
    expect(scoped.some((l) => l.type === 'text' && l.assetId === 'a2')).toBe(false)
  })
})

describe('defaultCropRule', () => {
  it('covers the full source region', () => {
    expect(defaultCropRule().region).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('uses the requested output size', () => {
    const rule = defaultCropRule(1920, 1080)
    expect(rule.outWidth).toBe(1920)
    expect(rule.outHeight).toBe(1080)
  })
})

describe('clampCropRegion', () => {
  it('clamps origin into [0, 1]', () => {
    const r = clampCropRegion({ x: -0.5, y: 1.5, w: 0.5, h: 0.5 })
    expect(r.x).toBe(0)
    expect(r.y).toBe(1)
  })

  it('shrinks size so the region stays inside the image', () => {
    const r = clampCropRegion({ x: 0.8, y: 0.9, w: 0.5, h: 0.5 })
    expect(r.w).toBeCloseTo(0.2)
    expect(r.h).toBeCloseTo(0.1)
  })

  it('enforces a minimum size of 0.01', () => {
    const r = clampCropRegion({ x: 0.5, y: 0.5, w: 0, h: 0 })
    expect(r.w).toBe(0.01)
    expect(r.h).toBe(0.01)
  })
})

describe('effectiveCrop', () => {
  const baseDoc = (): EditorDocument => createEmptyDocument()

  it('returns null for non-image layers', () => {
    expect(effectiveCrop(newTextLayer(), baseDoc())).toBeNull()
  })

  it('prefers the layer override over the shared rule', () => {
    const doc = baseDoc()
    const layer = newImageLayer({ assetId: 'a', width: 100, height: 100 })
    const override = { ...defaultCropRule(640, 480), region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }
    doc.sharedCrop = defaultCropRule(1280, 720)
    if (layer.type === 'image') layer.cropOverride = override
    expect(effectiveCrop(layer, doc)).toBe(override)
  })

  it('falls back to the shared rule when applySameCropToAll is on', () => {
    const doc = baseDoc()
    doc.applySameCropToAll = true
    doc.sharedCrop = defaultCropRule(1280, 720)
    const layer = newImageLayer({ assetId: 'a', width: 100, height: 100 })
    expect(effectiveCrop(layer, doc)).toBe(doc.sharedCrop)
  })

  it('returns null when applySameCropToAll is off and there is no override', () => {
    const doc = baseDoc()
    doc.applySameCropToAll = false
    doc.sharedCrop = defaultCropRule()
    const layer = newImageLayer({ assetId: 'a', width: 100, height: 100 })
    expect(effectiveCrop(layer, doc)).toBeNull()
  })
})

describe('overlay image layer (ownerAssetId)', () => {
  it('shows the overlay only on its owner asset, not on its own asset', () => {
    const overlay = newImageLayer({
      assetId: 'overlayAsset',
      ownerAssetId: 'a1',
      width: 50,
      height: 50,
    })
    expect(layerVisibleForAsset(overlay, 'a1')).toBe(true)
    expect(layerVisibleForAsset(overlay, 'overlayAsset')).toBe(false)
    expect(layerVisibleForAsset(overlay, 'a2')).toBe(false)
    expect(layerVisibleForAsset(overlay, null)).toBe(false)
  })

  it('gives a fresh image layer no ownerAssetId (regular screenshot)', () => {
    const base = newImageLayer({ assetId: 'a1', width: 100, height: 100 })
    expect(base.type === 'image' && base.ownerAssetId).toBeNull()
  })

  it('does not inherit the shared crop when it has no override', () => {
    const doc = createEmptyDocument()
    doc.applySameCropToAll = true
    doc.sharedCrop = defaultCropRule(1280, 720)
    const overlay = newImageLayer({
      assetId: 'overlayAsset',
      ownerAssetId: 'a1',
      width: 50,
      height: 50,
    })
    expect(effectiveCrop(overlay, doc)).toBeNull()
  })

  it('keeps its own crop override', () => {
    const doc = createEmptyDocument()
    const own = defaultCropRule(320, 240)
    const overlay = newImageLayer({
      assetId: 'overlayAsset',
      ownerAssetId: 'a1',
      cropOverride: own,
      width: 50,
      height: 50,
    })
    expect(effectiveCrop(overlay, doc)).toBe(own)
  })

  it('parses documents with an overlay layer (and legacy ones without the field)', () => {
    const doc = createEmptyDocument()
    doc.layers.push(
      newImageLayer({ assetId: 'a1', width: 100, height: 100 }),
      newImageLayer({ assetId: 'a2', ownerAssetId: 'a1', width: 50, height: 50 }),
    )
    expect(parseDocument(doc).ok).toBe(true)
    // Legacy: field hilang sama sekali tetap valid.
    const raw = structuredClone(doc) as unknown as {
      layers: Array<Record<string, unknown>>
    }
    delete raw.layers[0]!.ownerAssetId
    expect(parseDocument(raw).ok).toBe(true)
  })
})
