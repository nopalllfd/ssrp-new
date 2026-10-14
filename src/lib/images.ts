import { supabase, ASSETS_BUCKET } from '@/lib/supabase'
import { loadAssetBlob } from '@/db/local'
import type { AssetRef, CropRule } from '@/types/editor'

/**
 * Resolve a display URL for an asset: local IndexedDB blob first, otherwise
 * a short-lived signed URL from Storage. Never persist the result — URLs
 * expire and blob URLs are session-scoped.
 */
export async function resolveAssetUrl(asset: AssetRef): Promise<string | null> {
  const blob = await loadAssetBlob(asset.id)
  if (blob) return URL.createObjectURL(blob)

  if (asset.objectKey) {
    const { data, error } = await supabase.storage
      .from(ASSETS_BUCKET)
      .createSignedUrl(asset.objectKey, 60 * 10)
    if (!error && data?.signedUrl) return data.signedUrl

    // Fallback: download into a blob URL (works with RLS for the owner).
    const { data: dl, error: dlErr } = await supabase.storage
      .from(ASSETS_BUCKET)
      .download(asset.objectKey)
    if (!dlErr && dl) {
      const url = URL.createObjectURL(dl)
      return url
    }
  }
  return null
}

const htmlImageCache = new Map<string, Promise<HTMLImageElement | null>>()

/** Load an asset as an HTMLImageElement, cached per asset id. */
export function loadAssetImage(asset: AssetRef): Promise<HTMLImageElement | null> {
  const cached = htmlImageCache.get(asset.id)
  if (cached) return cached
  const promise = (async () => {
    const url = await resolveAssetUrl(asset)
    if (!url) return null
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.crossOrigin = 'anonymous'
        i.onload = () => resolve(i)
        i.onerror = () => reject(new Error('Failed to load image'))
        i.src = url
      })
      return img
    } catch {
      return null
    }
  })()
  htmlImageCache.set(asset.id, promise)
  return promise
}

export function evictAssetImage(assetId: string) {
  htmlImageCache.delete(assetId)
}

/**
 * Render one image asset through its crop rule and layout transform to a
 * canvas. Used by both single-image export and ZIP batch export.
 */
export async function renderAssetExport(input: {
  asset: AssetRef
  crop: CropRule
}): Promise<HTMLCanvasElement> {
  const { asset, crop } = input
  const img = await loadAssetImage(asset)
  if (!img) throw new Error(`Could not load ${asset.name}`)

  const srcW = img.naturalWidth
  const srcH = img.naturalHeight
  const sx = crop.region.x * srcW
  const sy = crop.region.y * srcH
  const sw = Math.max(1, crop.region.w * srcW)
  const sh = Math.max(1, crop.region.h * srcH)

  const canvas = document.createElement('canvas')
  canvas.width = crop.outWidth
  canvas.height = crop.outHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  if (crop.fit === 'fit') {
    ctx.fillStyle = crop.padColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const scale = Math.min(canvas.width / sw, canvas.height / sh)
    const dw = sw * scale
    const dh = sh * scale
    const dx = (canvas.width - dw) / 2
    const dy = (canvas.height - dh) / 2
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
  } else {
    // 'crop': fill the output entirely, allowing source-region overflow.
    const scale = Math.max(canvas.width / sw, canvas.height / sh)
    const dw = sw * scale
    const dh = sh * scale
    const dx = (canvas.width - dw) / 2
    const dy = (canvas.height - dh) / 2
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
  }
  return canvas
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: 'png' | 'jpeg' | 'webp',
  quality: number,
  background: string,
): Promise<Blob> {
  let target = canvas
  if (format !== 'png') {
    // JPEG/WebP exports get an opaque background; PNG keeps transparency.
    const flat = document.createElement('canvas')
    flat.width = canvas.width
    flat.height = canvas.height
    const ctx = flat.getContext('2d')
    if (ctx) {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, flat.width, flat.height)
      ctx.drawImage(canvas, 0, 0)
      target = flat
    }
  }
  return new Promise((resolve, reject) => {
    target.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export encoding failed'))),
      `image/${format === 'jpeg' ? 'jpeg' : format}`,
      quality,
    )
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
