import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Unlock } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import {
  clampCropRegion,
  defaultCropRule,
  effectiveCrop,
  refitImageLayers,
} from '@/lib/editorDocument'
import { loadAssetImage, renderAssetExport, resolveAssetUrl } from '@/lib/images'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label, Select } from '@/components/ui/misc'
import { ColorField, NumberField } from '@/components/editor/PropertiesPanel'
import type { CropRule, ImageLayer } from '@/types/editor'

const RESOLUTION_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '1280 × 720 (HD)', w: 1280, h: 720 },
  { label: '1920 × 1080 (Full HD)', w: 1920, h: 1080 },
  { label: '1600 × 900', w: 1600, h: 900 },
  { label: '1366 × 768', w: 1366, h: 768 },
  { label: '1280 × 960 (SA-MP native)', w: 1280, h: 960 },
  { label: '1024 × 768', w: 1024, h: 768 },
  { label: '800 × 600', w: 800, h: 600 },
]

type Handle = 'nw' | 'ne' | 'sw' | 'se'
type DragState =
  | { kind: 'move'; startX: number; startY: number; region: CropRule['region'] }
  | { kind: Handle; startX: number; startY: number; region: CropRule['region'] }

/**
 * Advanced crop editor. The region is stored in normalized source
 * coordinates so one rule can be replayed across images of any size —
 * that is what makes "apply same crop to all" and batch export possible.
 */
export function CropDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const document = useEditorStore((s) => s.document)
  const selection = useEditorStore((s) => s.selection)
  const activeAssetId = useEditorStore((s) => s.activeAssetId)
  const mutate = useEditorStore((s) => s.mutate)

  // Termasuk layer overlay (objek gambar tempel) — crop-nya disimpan
  // sebagai override miliknya sendiri, tidak ikut shared crop.
  const imageLayers = useMemo(
    () =>
      document.layers.filter(
        (l): l is ImageLayer => l.type === 'image' && !!document.assets[l.assetId],
      ),
    [document],
  )

  const [layerId, setLayerId] = useState<string | null>(null)
  const [rule, setRule] = useState<CropRule>(() => defaultCropRule(1280, 720))
  const [scope, setScope] = useState<'shared' | 'override'>('shared')
  const [lockAspect, setLockAspect] = useState(true)

  const layer = imageLayers.find((l) => l.id === layerId) ?? null
  const asset = layer ? document.assets[layer.assetId] : undefined
  const isOverlay = !!layer?.ownerAssetId

  // Pick the layer that is SELECTED on canvas first (that is what the user
  // actually wants to crop), falling back to the active image, then the
  // first one, whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    const preferred =
      imageLayers.find((l) => selection.includes(l.id)) ??
      imageLayers.find((l) => l.assetId === activeAssetId) ??
      imageLayers[0] ??
      null
    setLayerId(preferred?.id ?? null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load the layer's effective crop into local editing state.
  useEffect(() => {
    if (!layer) return
    const base = effectiveCrop(layer, document) ?? defaultCropRule(layer.width, layer.height)
    setRule(structuredClone(base))
    // Overlay selalu override — tidak mewarisi/menulis shared crop.
    setScope(layer.ownerAssetId || layer.cropOverride ? 'override' : 'shared')
    prevAspectRef.current = base.outWidth / base.outHeight
  }, [layerId, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-cut: when the output ASPECT genuinely changes (e.g. 16:9 -> 4:3),
  // re-fit the crop region to the new aspect (center preserved, clamped
  // inside the image). Pure resolution changes with the same aspect (e.g.
  // 1920x1080 -> 1280x720) must NOT touch the region — that is just a
  // downscale. A 2% tolerance absorbs near-identical ratios like 1366x768.
  const prevAspectRef = useRef(16 / 9)
  useEffect(() => {
    if (!asset) return
    const aspect = rule.outWidth / rule.outHeight
    if (!Number.isFinite(aspect) || aspect <= 0) return
    if (Math.abs(aspect - prevAspectRef.current) / prevAspectRef.current < 0.02) return
    prevAspectRef.current = aspect
    setLockAspect(true)
    setRule((r) => ({
      ...r,
      region: fitRegionToAspect(r.region, aspect, asset.width, asset.height),
    }))
  }, [rule.outWidth, rule.outHeight, asset])

  const setRegion = useCallback(
    (region: CropRule['region']) =>
      setRule((r) => ({ ...r, region: clampCropRegion(region) })),
    [],
  )

  const apply = () => {
    if (!layer) return
    const targetId = layer.id
    mutate((doc) => {
      // Overlay tidak boleh ikut shared crop — selalu override miliknya.
      if (scope === 'shared' && !layer.ownerAssetId) {
        doc.sharedCrop = structuredClone(rule)
        doc.applySameCropToAll = true
      } else {
        const l = doc.layers.find((x) => x.id === targetId)
        if (l?.type === 'image') l.cropOverride = structuredClone(rule)
      }
      refitImageLayers(doc)
    })
    onOpenChange(false)
  }

  const clearOverride = () => {
    if (!layer) return
    const targetId = layer.id
    mutate((doc) => {
      const l = doc.layers.find((x) => x.id === targetId)
      if (l?.type === 'image') l.cropOverride = null
      refitImageLayers(doc)
    })
    setScope('shared')
    const doc = useEditorStore.getState().document
    const shared = doc.sharedCrop ?? defaultCropRule(layer.width, layer.height)
    setRule(structuredClone(shared))
  }

  const clearShared = () => {
    mutate((doc) => {
      doc.sharedCrop = null
      doc.applySameCropToAll = false
      refitImageLayers(doc)
    })
    onOpenChange(false)
  }

  const presetValue = useMemo(() => {
    const idx = RESOLUTION_PRESETS.findIndex(
      (p) => p.w === rule.outWidth && p.h === rule.outHeight,
    )
    return idx >= 0 ? String(idx) : 'custom'
  }, [rule.outWidth, rule.outHeight])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Crop & resolution"
        onClose={() => onOpenChange(false)}
        className="max-w-4xl"
      >
        {imageLayers.length === 0 || !layer || !asset ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Import an image first to configure cropping.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_280px]">
            <RegionEditor
              assetId={asset.id}
              objectKey={asset.objectKey}
              status={asset.status}
              name={asset.name}
              imgWidth={asset.width}
              imgHeight={asset.height}
              region={rule.region}
              lockAspect={lockAspect}
              outAspect={rule.outWidth / rule.outHeight}
              onRegionChange={setRegion}
            />

            <div className="flex flex-col gap-3">
              <div>
                <Label>Image</Label>
                <Select
                  className="mt-1"
                  value={layer.id}
                  onChange={(e) => setLayerId(e.target.value)}
                >
                  {imageLayers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.ownerAssetId ? ' (objek tempel)' : ''}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label>Apply to</Label>
                <Select
                  className="mt-1"
                  value={isOverlay || !document.applySameCropToAll ? 'override' : scope}
                  disabled={isOverlay || !document.applySameCropToAll}
                  onChange={(e) => setScope(e.target.value as 'shared' | 'override')}
                >
                  <option value="shared">All images (shared rule)</option>
                  <option value="override">This image only (override)</option>
                </Select>
                {isOverlay ? (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Objek gambar tempel selalu disimpan sebagai crop miliknya sendiri.
                  </p>
                ) : (
                  !document.applySameCropToAll && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      “Apply same crop to all” nonaktif — rule disimpan sebagai override
                      per-gambar.
                    </p>
                  )
                )}
              </div>

              <div>
                <Label>Resolution preset</Label>
                <Select
                  className="mt-1"
                  value={presetValue}
                  onChange={(e) => {
                    if (e.target.value === 'custom') return
                    const p = RESOLUTION_PRESETS[Number(e.target.value)]
                    if (p) setRule((r) => ({ ...r, outWidth: p.w, outHeight: p.h }))
                  }}
                >
                  {RESOLUTION_PRESETS.map((p, i) => (
                    <option key={p.label} value={String(i)}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Output width"
                  value={rule.outWidth}
                  onChange={(v) =>
                    setRule((r) => ({ ...r, outWidth: Math.max(1, Math.round(v)) }))
                  }
                />
                <NumberField
                  label="Output height"
                  value={rule.outHeight}
                  onChange={(v) =>
                    setRule((r) => ({ ...r, outHeight: Math.max(1, Math.round(v)) }))
                  }
                />
              </div>

              <div>
                <Label>Fit mode</Label>
                <Select
                  className="mt-1"
                  value={rule.fit}
                  onChange={(e) =>
                    setRule((r) => ({ ...r, fit: e.target.value as CropRule['fit'] }))
                  }
                >
                  <option value="crop">Crop (fill, potong overflow)</option>
                  <option value="fit">Fit (muat semua, tambah padding)</option>
                </Select>
              </div>

              {rule.fit === 'fit' && (
                <ColorField
                  label="Padding color"
                  value={rule.padColor}
                  onChange={(v) => setRule((r) => ({ ...r, padColor: v }))}
                />
              )}

              <button
                type="button"
                onClick={() => setLockAspect((v) => !v)}
                className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {lockAspect ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                Lock region aspect to output ({rule.outWidth}:{rule.outHeight})
              </button>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setRegion({ x: 0, y: 0, w: 1, h: 1 })}
                >
                  Reset region
                </button>
              </div>

              <OutputPreview assetId={asset.id} rule={rule} />

              <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
                <Button onClick={apply}>Apply crop</Button>
                <div className="flex gap-2">
                  {layer.cropOverride && (
                    <Button variant="outline" size="sm" onClick={clearOverride}>
                      Remove override
                    </Button>
                  )}
                  {document.sharedCrop && scope === 'shared' && (
                    <Button variant="outline" size="sm" onClick={clearShared}>
                      Remove shared crop
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------ region editor

function RegionEditor({
  assetId,
  objectKey,
  status,
  name,
  imgWidth,
  imgHeight,
  region,
  lockAspect,
  outAspect,
  onRegionChange,
}: {
  assetId: string
  objectKey: string | null
  status: string
  name: string
  imgWidth: number
  imgHeight: number
  region: CropRule['region']
  lockAspect: boolean
  outAspect: number
  onRegionChange: (r: CropRule['region']) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    void resolveAssetUrl({ id: assetId, objectKey, status } as never).then((u) => {
      if (cancelled || !u) return
      objectUrl = u
      setUrl(u)
    })
    return () => {
      cancelled = true
      if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
    }
  }, [assetId, objectKey, status])

  const toNormalized = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { nx: 0, ny: 0 }
    return {
      nx: (clientX - rect.left) / rect.width,
      ny: (clientY - rect.top) / rect.height,
    }
  }

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      /** Locked aspect: displayed region ratio must equal the output ratio. */
      const aspectHeight = (w: number) => (w * imgWidth) / (imgHeight * outAspect)
      const { nx, ny } = toNormalized(e.clientX, e.clientY)
      const dx = nx - d.startX
      const dy = ny - d.startY
      const s = d.region

      if (d.kind === 'move') {
        onRegionChange({
          ...s,
          x: Math.min(Math.max(s.x + dx, 0), 1 - s.w),
          y: Math.min(Math.max(s.y + dy, 0), 1 - s.h),
        })
        return
      }

      const handle = d.kind
      let { x, y, w, h } = s
      if (handle === 'se') {
        w = s.w + dx
        h = lockAspect ? aspectHeight(Math.max(w, 0.02)) : s.h + dy
      } else if (handle === 'ne') {
        w = s.w + dx
        h = lockAspect ? aspectHeight(Math.max(w, 0.02)) : s.h - dy
        y = s.y + s.h - h
      } else if (handle === 'sw') {
        w = s.w - dx
        x = s.x + s.w - w
        h = lockAspect ? aspectHeight(Math.max(w, 0.02)) : s.h + dy
      } else {
        w = s.w - dx
        x = s.x + s.w - w
        h = lockAspect ? aspectHeight(Math.max(w, 0.02)) : s.h - dy
        y = s.y + s.h - h
      }
      w = Math.max(0.02, Math.min(w, 1))
      h = Math.max(0.02, Math.min(h, 1))
      x = Math.max(0, Math.min(x, 1 - w))
      y = Math.max(0, Math.min(y, 1 - h))
      onRegionChange({ x, y, w, h })
    },
    [lockAspect, outAspect, imgWidth, imgHeight, onRegionChange],
  )

  const beginDrag = (e: React.PointerEvent, state: DragState) => {
    e.preventDefault()
    e.stopPropagation()
    const { nx, ny } = toNormalized(e.clientX, e.clientY)
    drag.current = { ...state, startX: nx, startY: ny }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag, { once: true })
  }

  const endDrag = useCallback(() => {
    drag.current = null
    window.removeEventListener('pointermove', onPointerMove)
  }, [onPointerMove])

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove)
  }, [onPointerMove])

  const handles: { id: Handle; style: React.CSSProperties }[] = [
    { id: 'nw', style: { left: 0, top: 0, cursor: 'nwse-resize' } },
    { id: 'ne', style: { right: 0, top: 0, cursor: 'nesw-resize' } },
    { id: 'sw', style: { left: 0, bottom: 0, cursor: 'nesw-resize' } },
    { id: 'se', style: { right: 0, bottom: 0, cursor: 'nwse-resize' } },
  ]

  return (
    <div>
      <div
        ref={containerRef}
        className="relative w-full touch-none overflow-hidden rounded-md border border-border bg-black/40 select-none"
      >
        {url ? (
          <img src={url} alt={name} className="block w-full" draggable={false} />
        ) : (
          <div className="flex aspect-video items-center justify-center text-xs text-muted-foreground">
            Loading image…
          </div>
        )}
        {/* dim outside the region */}
        <div
          className="absolute inset-0 bg-black/55"
          style={{
            clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${pct(region.x)}% ${pct(region.y)}%, ${pct(region.x)}% ${pct(region.y + region.h)}%, ${pct(region.x + region.w)}% ${pct(region.y + region.h)}%, ${pct(region.x + region.w)}% ${pct(region.y)}%, ${pct(region.x)}% ${pct(region.y)}%)`,
          }}
        />
        {/* region rect */}
        <div
          role="presentation"
          className="absolute cursor-move border-2 border-primary"
          style={{
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.w * 100}%`,
            height: `${region.h * 100}%`,
          }}
          onPointerDown={(e) => beginDrag(e, { kind: 'move', startX: 0, startY: 0, region })}
        >
          {handles.map((h) => (
            <span
              key={h.id}
              role="presentation"
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-background bg-primary"
              style={{
                ...h.style,
                left: h.style.left !== undefined ? h.style.left : undefined,
              }}
              onPointerDown={(e) => beginDrag(e, { kind: h.id, startX: 0, startY: 0, region })}
            />
          ))}
        </div>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Sumber {imgWidth}×{imgHeight} · region {Math.round(region.w * imgWidth)}×
        {Math.round(region.h * imgHeight)} px — seret untuk memindahkan, sudut untuk resize.
      </p>
    </div>
  )
}

function pct(v: number): string {
  return (v * 100).toFixed(3)
}

/**
 * Re-fit a normalized crop region to a target pixel aspect while keeping its
 * center. Width is preserved when possible; otherwise it shrinks to fit.
 */
function fitRegionToAspect(
  region: CropRule['region'],
  aspect: number,
  imgWidth: number,
  imgHeight: number,
): CropRule['region'] {
  if (!(aspect > 0) || !(imgWidth > 0) || !(imgHeight > 0)) {
    return clampCropRegion(region)
  }
  const cx = region.x + region.w / 2
  const cy = region.y + region.h / 2
  let w = region.w
  let h = (w * imgWidth) / (aspect * imgHeight)
  if (h > 1) {
    h = 1
    w = (h * aspect * imgHeight) / imgWidth
  }
  if (w > 1) {
    w = 1
    h = (w * imgWidth) / (aspect * imgHeight)
  }
  w = Math.max(0.02, Math.min(1, w))
  h = Math.max(0.02, Math.min(1, h))
  const x = Math.min(Math.max(cx - w / 2, 0), 1 - w)
  const y = Math.min(Math.max(cy - h / 2, 0), 1 - h)
  return clampCropRegion({ x, y, w, h })
}

// ------------------------------------------------------------- live preview

function OutputPreview({ assetId, rule }: { assetId: string; rule: CropRule }) {
  const [preview, setPreview] = useState<string | null>(null)
  const document = useEditorStore((s) => s.document)

  useEffect(() => {
    const asset = document.assets[assetId]
    if (!asset) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await loadAssetImage(asset)
          const canvas = await renderAssetExport({ asset, crop: rule })
          if (cancelled) return
          setPreview(canvas.toDataURL('image/png'))
        } catch {
          if (!cancelled) setPreview(null)
        }
      })()
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [assetId, rule, document.assets])

  return (
    <div>
      <Label>Output preview ({rule.outWidth}×{rule.outHeight})</Label>
      <div className="mt-1 flex min-h-20 items-center justify-center overflow-hidden rounded-md border border-border bg-black/40">
        {preview ? (
          <img src={preview} alt="Crop output preview" className="max-h-40 max-w-full" />
        ) : (
          <span className="py-6 text-xs text-muted-foreground">Rendering…</span>
        )}
      </div>
    </div>
  )
}
