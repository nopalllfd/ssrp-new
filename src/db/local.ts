import Dexie, { type EntityTable } from 'dexie'
import type { EditorDocument } from '@/types/editor'

/**
 * IndexedDB persistence:
 * - drafts: unsynced editor documents per project (recovery after refresh)
 * - uploadQueue: pending file uploads, persisted so a closed tab can resume
 * - blobs: local copies of imported files (until synced to cloud)
 */

export interface DraftRow {
  projectId: string
  document: EditorDocument
  baseRevision: number | null
  updatedAt: number
}

export interface QueuedUploadRow {
  id: string
  projectId: string
  assetId: string
  objectKey: string
  attempts: number
  lastError: string | null
  enqueuedAt: number
}

export interface BlobRow {
  assetId: string
  blob: Blob
  kind: 'original' | 'thumbnail'
}

export const localDb = new Dexie('ssrp-tools') as Dexie & {
  drafts: EntityTable<DraftRow, 'projectId'>
  uploadQueue: EntityTable<QueuedUploadRow, 'id'>
  blobs: EntityTable<BlobRow, 'assetId'>
}

localDb.version(1).stores({
  drafts: 'projectId, updatedAt',
  uploadQueue: 'id, projectId, assetId, enqueuedAt',
  blobs: 'assetId, kind',
})

export async function saveDraft(row: DraftRow): Promise<void> {
  await localDb.drafts.put(row)
}

export async function loadDraft(projectId: string): Promise<DraftRow | undefined> {
  return localDb.drafts.get(projectId)
}

export async function clearDraft(projectId: string): Promise<void> {
  await localDb.drafts.delete(projectId)
}

export async function enqueueUpload(row: QueuedUploadRow): Promise<void> {
  await localDb.uploadQueue.put(row)
}

export async function dequeueUpload(id: string): Promise<void> {
  await localDb.uploadQueue.delete(id)
}

export async function listQueuedUploads(): Promise<QueuedUploadRow[]> {
  return localDb.uploadQueue.orderBy('enqueuedAt').toArray()
}

export async function saveAssetBlob(assetId: string, blob: Blob): Promise<void> {
  await localDb.blobs.put({ assetId, blob, kind: 'original' })
}

export async function loadAssetBlob(assetId: string): Promise<Blob | undefined> {
  const row = await localDb.blobs.get(assetId)
  return row?.blob
}

export async function deleteAssetBlob(assetId: string): Promise<void> {
  await localDb.blobs.delete(assetId)
}
