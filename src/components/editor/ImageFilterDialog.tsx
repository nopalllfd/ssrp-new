import Konva from 'konva'
import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '@/store/editor'
import { effectiveCrop } from '@/lib/editorDocument'
import { applyKonvaImageFilter, DEFAULT_IMAGE_FILTER } from '@/lib/imageFilters'
import { loadAssetImage } from '@/lib/images'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label, Select, Slider } from '@/components/ui/misc'
import type { ImageFilter, ImageLayer, Layer } from '@/types/editor'

const identity = { to: (v: number) => Math.round(v), from: (v: number) => v }
const percent = { to: (v: number) => Math.round(v * 100), from: (v: number) => v / 100 }

/** Definisi slider intensitas — domain tampilan vs domain dokumen. */
const SLIDERS: {
  key: keyof ImageFilter
  label: string
  min: number
  max: number
  to: (v: number) => number
  from: (v: number) => number
}[] = [
  { key: 'brightness', label: 'Cahaya', min: -100, max: 100, ...percent },
  { key: 'contrast', label: 'Kontras', min: -100, max: 100, ...identity },
  { key: 'saturate', label: 'Saturasi warna', min: -100, max: 100, ...percent },
  { key: 'hue', label: 'Hue warna', min: -180, max: 180, ...identity },
  { key: 'blur', label: 'Blur', min: 0, max: 40, ...identity },
  { key: 'noise', label: 'Bintik-bintik', min: 0, max: 100, ...percent },
  { key: 'grayscale', label: 'Hitam putih', min: 0, max: 100, ...percent },
  { key: 'sepia', label: 'Sepia', min: 0, max: 100, ...percent },
]

/**
 * Penyesuai filter per layer gambar (termasuk objek tempel/overlay).
 * Nilai diedit lewat slider lokal dan baru ditulis ke dokumen saat
 * "Terapkan" ditekan — undo history tetap satu entri per penerapan.
 */
export function ImageFilterDialog({
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

  const imageLayers = useMemo(
    () =>
      document.layers.filter(
        (l): l is ImageLayer => l.type === 'image' && !!document.assets[l.assetId],
      ),
    [document],
  )

  const [layerId, setLayerId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ImageFilter>({ ...DEFAULT_IMAGE_FILTER })
  const [scope, setScope] = useState<'this' | 'all'>('this')

  const layer = imageLayers.find((l) => l.id === layerId) ?? null
  const asset = layer ? document.assets[layer.assetId] : undefined
  // Objek tempel punya filter sendiri — tidak ikut penyebaran "semua gambar".
  const isOverlay = !!layer?.ownerAssetId

  // Prioritaskan layer yang TERSELEKSI di kanvas, lalu gambar aktif,
  // lalu yang pertama — sama seperti dialog crop.
  useEffect(() => {
    if (!open) return
    const preferred =
      imageLayers.find((l) => selection.includes(l.id)) ??
      imageLayers.find((l) => l.assetId === activeAssetId) ??
      imageLayers[0] ??
      null
    setLayerId(preferred?.id ?? null)
    setScope('this')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Muat filter milik layer ke state lokal saat target berubah.
  useEffect(() => {
    if (!layer) return
    setFilter({ ...DEFAULT_IMAGE_FILTER, ...(layer.filter ?? {}) })
    setScope('this')
  }, [layerId, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    if (!layer) return
    const targetId = layer.id
    mutate((doc) => {
      if (scope === 'all') {
        // Sebarkan filter yang sama ke semua screenshot (objek tempel tidak ikut).
        for (const l of doc.layers) {
          if (l.type === 'image' && !l.ownerAssetId) l.filter = structuredClone(filter)
        }
        return
      }
      const l = doc.layers.find((x) => x.id === targetId)
      if (l?.type === 'image') l.filter = structuredClone(filter)
    })
    onOpenChange(false)
  }

  const removeFilter = () => {
    if (!layer) return
    const targetId = layer.id
    mutate((doc) => {
      const l = doc.layers.find((x) => x.id === targetId)
      if (l?.type === 'image') l.filter = null
    })
    setFilter({ ...DEFAULT_IMAGE_FILTER })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Filter gambar" onClose={() => onOpenChange(false)} className="max-w-3xl">
        {imageLayers.length === 0 || !layer || !asset ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Import gambar dulu untuk mengatur filter.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_280px]">
            <FilterPreview layer={layer} filter={filter} />

            <div className="app-scrollbar flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
              <div>
                <Label>Gambar</Label>
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
                <Label>Terapkan ke</Label>
                <Select
                  className="mt-1"
                  value={isOverlay ? 'this' : scope}
                  disabled={isOverlay}
                  onChange={(e) => setScope(e.target.value as 'this' | 'all')}
                >
                  <option value="this">Gambar ini saja</option>
                  <option value="all">Semua gambar</option>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isOverlay
                    ? 'Objek tempel punya filter sendiri — tidak ikut "Semua gambar".'
                    : scope === 'all'
                      ? 'Filter ini diterapkan ke semua screenshot (objek tempel tidak ikut).'
                      : 'Hanya gambar yang dipilih di atas.'}
                </p>
              </div>

              {SLIDERS.map((s) => (
                <div key={s.key}>
                  <div className="flex items-baseline justify-between">
                    <Label>{s.label}</Label>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {s.to(filter[s.key])}
                    </span>
                  </div>
                  <Slider
                    className="mt-1"
                    min={s.min}
                    max={s.max}
                    step={1}
                    value={s.to(filter[s.key])}
                    onChange={(e) =>
                      setFilter((f) => ({ ...f, [s.key]: s.from(Number(e.target.value)) }))
                    }
                  />
                </div>
              ))}

              <button
                type="button"
                className="self-start cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setFilter({ ...DEFAULT_IMAGE_FILTER })}
              >
                Reset semua slider
              </button>

              <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
                <Button onClick={apply}>
                  {scope === 'all' && !isOverlay ? 'Terapkan ke semua gambar' : 'Terapkan filter'}
                </Button>
                {layer.filter && (
                  <Button variant="outline" size="sm" onClick={removeFilter}>
                    Hapus filter
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------- live preview

/** Pratinjau gambar + filter dirender offscreen lewat Konva, agar sama persis dengan kanvas/ekspor. */
function FilterPreview({
  layer,
  filter,
}: {
  layer: Extract<Layer, { type: 'image' }>
  filter: ImageFilter
}) {
  const document = useEditorStore((s) => s.document)
  const [preview, setPreview] = useState<string | null>(null)
  const filterKey = JSON.stringify(filter)
  const cropKey = JSON.stringify(effectiveCrop(layer, document)?.region ?? null)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const asset = document.assets[layer.assetId]
          if (!asset) return
          const image = await loadAssetImage(asset)
          if (!image) return
          const crop = effectiveCrop(layer, document)
          const konvaCrop = crop
            ? {
                x: crop.region.x * asset.width,
                y: crop.region.y * asset.height,
                width: crop.region.w * asset.width,
                height: crop.region.h * asset.height,
              }
            : undefined
          const url = renderFilterPreview(image, konvaCrop, JSON.parse(filterKey))
          if (!cancelled) setPreview(url)
        } catch {
          if (!cancelled) setPreview(null)
        }
      })()
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.id, filterKey, cropKey, document.assets])

  return (
    <div>
      <Label>Pratinjau</Label>
      <div className="mt-1 flex min-h-40 items-center justify-center overflow-hidden rounded-md border border-border bg-black/40">
        {preview ? (
          <img src={preview} alt="Pratinjau filter" className="max-h-[60vh] max-w-full" />
        ) : (
          <span className="py-6 text-xs text-muted-foreground">Merender…</span>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Filter langsung terlihat di kanvas setelah diterapkan.
      </p>
    </div>
  )
}

function renderFilterPreview(
  image: HTMLImageElement,
  crop: { x: number; y: number; width: number; height: number } | undefined,
  filter: ImageFilter,
): string {
  const srcW = crop?.width ?? image.naturalWidth
  const srcH = crop?.height ?? image.naturalHeight
  const scale = Math.min(1, 520 / Math.max(1, srcW))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))

  const container = window.document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  window.document.body.appendChild(container)

  const stage = new Konva.Stage({ container, width: w, height: h })
  try {
    const layer = new Konva.Layer()
    stage.add(layer)
    const node = new Konva.Image({
      image,
      crop,
      width: w,
      height: h,
      listening: false,
    })
    applyKonvaImageFilter(node, filter)
    layer.add(node)
    return stage.toDataURL({ pixelRatio: 1 })
  } finally {
    stage.destroy()
    container.remove()
  }
}
