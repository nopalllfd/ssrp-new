import { useCallback, useRef } from 'react'
import { nanoid } from 'nanoid'
import { supabase, ASSETS_BUCKET } from '@/lib/supabase'
import {
  createAssetRecord,
  deleteAssetRecord,
  setAssetStatus,
} from '@/lib/api'
import {
  enqueueUpload,
  dequeueUpload,
  saveAssetBlob,
  loadAssetBlob,
  deleteAssetBlob,
} from '@/db/local'
import { useEditorStore } from '@/store/editor'
import { newImageLayer } from '@/store/editor'
import { defaultCropRule } from '@/lib/editorDocument'
import type { AssetRef } from '@/types/editor'

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_CONCURRENT_UPLOADS = 2

export interface ImportResult {
  imported: number
  rejected: { name: string; reason: string }[]
}

async function sha256Short(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function loadImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight }
      URL.revokeObjectURL(url)
      resolve(dims)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Unsupported or corrupt image file'))
    }
    img.src = url
  })
}

/**
 * Asset import and hybrid local/cloud uploads.
 *
 * Flow: file validation → local blob store + document asset entry → enqueue
 * upload → (background) create asset row → upload original to Storage → mark
 * ready. The editor stays usable the whole time; previews come from local
 * blobs while uploads run.
 */
export function useAssets(projectId: string) {
  const activeUploads = useRef(0)

  const pumpQueue = useCallback(async () => {
    while (activeUploads.current < MAX_CONCURRENT_UPLOADS) {
      const store = useEditorStore.getState()
      const nextQueued = Object.values(store.document.assets).find(
        (a) => a.status === 'queued',
      )
      if (!nextQueued) return
      activeUploads.current += 1
      void uploadAsset(projectId, nextQueued.id).finally(() => {
        activeUploads.current -= 1
        void pumpQueue()
      })
    }
  }, [projectId])

  const importFiles = useCallback(
    async (
      files: File[],
      opts?: { overlayOn?: string | null },
    ): Promise<ImportResult> => {
      const overlayOn = opts?.overlayOn ?? null
      const rejected: { name: string; reason: string }[] = []
      let imported = 0
      let lastImportedAssetId: string | null = null
      let lastOverlayLayerId: string | null = null
      const store = useEditorStore.getState()
      const existingChecksums = new Set(
        Object.values(store.document.assets).map((a) => a.checksum),
      )

      for (const file of files) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          rejected.push({ name: file.name, reason: `Unsupported type ${file.type || 'unknown'}` })
          continue
        }
        if (file.size > MAX_FILE_SIZE) {
          rejected.push({ name: file.name, reason: 'File exceeds 50 MB' })
          continue
        }

        let dims: { width: number; height: number }
        let checksum: string
        try {
          ;[dims, checksum] = await Promise.all([
            loadImageDimensions(file),
            sha256Short(file),
          ])
        } catch (e) {
          rejected.push({
            name: file.name,
            reason: e instanceof Error ? e.message : 'Failed to read image',
          })
          continue
        }

        if (existingChecksums.has(checksum)) {
          rejected.push({ name: file.name, reason: 'Duplicate of an existing asset' })
          continue
        }
        existingChecksums.add(checksum)

        const assetId = nanoid()
        const asset: AssetRef = {
          id: assetId,
          name: file.name,
          mimeType: file.type,
          width: dims.width,
          height: dims.height,
          fileSize: file.size,
          checksum,
          objectKey: null,
          status: 'queued',
          uploadProgress: 0,
          error: null,
        }

        await saveAssetBlob(assetId, file)
        await enqueueUpload({
          id: `${projectId}:${assetId}`,
          projectId,
          assetId,
          objectKey: '',
          attempts: 0,
          lastError: null,
          enqueuedAt: Date.now(),
        })

        useEditorStore.getState().mutate((doc) => {
          doc.assets[assetId] = asset
          if (overlayOn) {
            // Overlay: menempel di atas gambar aktif. Awalnya di-fit rata tengah
            // ke dalam bingkai gambar induk yang sedang tampil di canvas.
            const owner = doc.layers.find(
              (l) => l.type === 'image' && !l.ownerAssetId && l.assetId === overlayOn,
            )
            const bw = owner && owner.type === 'image' ? owner.width : doc.canvas.width
            const bh = owner && owner.type === 'image' ? owner.height : doc.canvas.height
            const bx = owner && owner.type === 'image' ? owner.x : 0
            const by = owner && owner.type === 'image' ? owner.y : 0
            const scale = Math.min(bw / dims.width, bh / dims.height, 1)
            const w = Math.max(1, Math.round(dims.width * scale))
            const h = Math.max(1, Math.round(dims.height * scale))
            const lyr = newImageLayer({
              assetId,
              ownerAssetId: overlayOn,
              // Crop penuh milik sendiri — overlay tidak mewarisi crop induk.
              cropOverride: defaultCropRule(dims.width, dims.height),
              width: w,
              height: h,
              x: Math.round(bx + (bw - w) / 2),
              y: Math.round(by + (bh - h) / 2),
              name: file.name,
            })
            doc.layers.push(lyr)
            lastOverlayLayerId = lyr.id
          } else {
            // Single-image canvas: fit the image inside the canvas and center it,
            // instead of stacking staggered copies over previous imports.
            const cw = doc.canvas.width
            const ch = doc.canvas.height
            const scale = Math.min(cw / dims.width, ch / dims.height, 1)
            const w = Math.max(1, Math.round(dims.width * scale))
            const h = Math.max(1, Math.round(dims.height * scale))
            doc.layers.push(
              newImageLayer({
                assetId,
                width: w,
                height: h,
                x: Math.round((cw - w) / 2),
                y: Math.round((ch - h) / 2),
                name: file.name,
              }),
            )
          }
        })
        imported += 1
        lastImportedAssetId = assetId
      }

      if (lastOverlayLayerId) {
        // Overlay tidak mengganti gambar aktif — cukup seleksi layernya.
        useEditorStore.getState().setSelection([lastOverlayLayerId])
      } else if (lastImportedAssetId) {
        useEditorStore.getState().setActiveAsset(lastImportedAssetId)
        useEditorStore.getState().setSelection([])
      }
      void pumpQueue()
      return { imported, rejected }
    },
    [projectId, pumpQueue],
  )

  const retryUpload = useCallback(
    (assetId: string) => {
      useEditorStore.getState().mutate((doc) => {
        const a = doc.assets[assetId]
        if (a) {
          a.status = 'queued'
          a.error = null
        }
      })
      void pumpQueue()
    },
    [pumpQueue],
  )

  return { importFiles, retryUpload, pumpQueue }
}

async function uploadAsset(projectId: string, assetId: string): Promise<void> {
  const store = useEditorStore.getState()
  const docAsset = store.document.assets[assetId]
  if (!docAsset) return

  useEditorStore.getState().mutate(
    (doc) => {
      const a = doc.assets[assetId]
      if (a) {
        a.status = 'uploading'
        a.uploadProgress = 5
      }
    },
    { coalesce: true },
  )
  useEditorStore.getState().setSyncStatus('uploading')

  try {
    const blob = await loadAssetBlob(assetId)
    if (!blob) throw new Error('Local file data is missing — re-import the image.')

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const objectKey = `users/${user.id}/projects/${projectId}/assets/${assetId}/original`

    const row = await createAssetRecord({
      projectId,
      originalName: docAsset.name,
      mimeType: docAsset.mimeType,
      fileSize: docAsset.fileSize,
      width: docAsset.width,
      height: docAsset.height,
      objectKey,
      checksum: docAsset.checksum,
    })

    useEditorStore.getState().mutate(
      (doc) => {
        const a = doc.assets[assetId]
        if (a) {
          a.objectKey = objectKey
          a.uploadProgress = 30
        }
      },
      { coalesce: true },
    )

    // NOTE: deliberately avoid `upsert: true` — that server path is known to
    // trip storage RLS ("new row violates row-level security policy") even
    // with correct policies. Do a plain insert, and only overwrite when the
    // object already exists (e.g. a previous attempt half-succeeded).
    const { error: uploadError } = await supabase.storage
      .from(ASSETS_BUCKET)
      .upload(objectKey, blob, {
        contentType: docAsset.mimeType,
      })
    if (uploadError) {
      if (/duplicate|already exists/i.test(uploadError.message)) {
        const { error: updateError } = await supabase.storage
          .from(ASSETS_BUCKET)
          .update(objectKey, blob, { contentType: docAsset.mimeType })
        if (updateError) throw new Error(updateError.message)
      } else {
        throw new Error(uploadError.message)
      }
    }

    await setAssetStatus(row.id, 'ready')

    await dequeueUpload(`${projectId}:${assetId}`)

    useEditorStore.getState().mutate(
      (doc) => {
        const a = doc.assets[assetId]
        if (a) {
          a.status = 'ready'
          a.uploadProgress = 100
          a.error = null
        }
      },
      { coalesce: true },
    )
    useEditorStore.getState().setSyncStatus('unsaved')
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed'
    useEditorStore.getState().mutate(
      (doc) => {
        const a = doc.assets[assetId]
        if (a) {
          a.status = 'error'
          a.error = message
        }
      },
      { coalesce: true },
    )
    void import('@/db/local').then(({ localDb }) =>
      localDb.uploadQueue
        .where('id')
        .equals(`${projectId}:${assetId}`)
        .modify((row) => {
          row.attempts += 1
          row.lastError = message
        }),
    )
    useEditorStore.getState().setSyncStatus('upload-failed')
  }
}

/**
 * Hapus layer dari dokumen. Layer overlay (objek gambar tempel) turut
 * membersihkan aset miliknya — doc.assets, blob lokal, dan record remote —
 * bila tidak ada layer lain yang masih memakainya, supaya aset yatim tidak
 * mendadak muncul lagi ke filmstrip setelah layer-nya dihapus.
 */
export function deleteLayers(layerIds: readonly string[], opts?: { skipLocked?: boolean }) {
  const store = useEditorStore.getState()
  const doc0 = store.document
  const want = new Set(layerIds)
  const removeIds = new Set(
    doc0.layers
      .filter((l) => want.has(l.id) && !(opts?.skipLocked && l.locked))
      .map((l) => l.id),
  )
  if (removeIds.size === 0) return
  // Aset overlay yang tak lagi dipakai layer manapun setelah penghapusan
  // (duplicate layer berbagi assetId) → yatim, ikut dimusnahkan.
  const orphanAssetIds = new Set<string>()
  for (const l of doc0.layers) {
    if (l.type !== 'image' || !l.ownerAssetId || !removeIds.has(l.id)) continue
    const stillUsed = doc0.layers.some(
      (o) =>
        o.type === 'image' &&
        o.assetId === l.assetId &&
        o.id !== l.id &&
        !removeIds.has(o.id),
    )
    if (!stillUsed) orphanAssetIds.add(l.assetId)
  }
  store.mutate((doc) => {
    doc.layers = doc.layers.filter((l) => !removeIds.has(l.id))
    for (const assetId of orphanAssetIds) delete doc.assets[assetId]
  })
  const after = useEditorStore.getState()
  after.setSelection(after.selection.filter((id) => !removeIds.has(id)))
  // Pembersihan storage — kegagalan bukan penghambat UI.
  for (const assetId of orphanAssetIds) {
    void deleteAssetRecord(assetId).catch(() => undefined)
    void deleteAssetBlob(assetId).catch(() => undefined)
  }
}

export { deleteAssetBlob, saveAssetBlob, loadAssetBlob }
