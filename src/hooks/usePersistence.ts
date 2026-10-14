import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '@/store/editor'
import {
  createVersion,
  getProjectState,
  listAssets,
  pruneAutomaticVersions,
  saveProjectState,
} from '@/lib/api'
import { clearDraft, loadDraft, saveDraft } from '@/db/local'
import { parseDocument } from '@/lib/editorDocument'

const AUTOSAVE_DEBOUNCE_MS = 2000
const LOCAL_DRAFT_DEBOUNCE_MS = 500
const AUTO_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000

type ConflictResolver = (choice: 'reload' | 'keep-local') => void

/**
 * Project persistence: debounced IndexedDB draft, debounced cloud autosave
 * with optimistic revision checks, automatic snapshots, conflict handling.
 */
export function usePersistence(
  projectId: string,
  onConflict?: (resolve: ConflictResolver) => void,
) {
  const draftTimer = useRef<number | null>(null)
  const saveTimer = useRef<number | null>(null)
  const snapshotTimer = useRef<number | null>(null)
  const lastSnapshotJson = useRef<string>('')
  const saving = useRef(false)

  const saveNow = useCallback(
    async (kind: 'auto' | 'manual' = 'auto') => {
      const store = useEditorStore.getState()
      if (saving.current || !store.dirty) return
      saving.current = true
      store.setSyncStatus(kind === 'auto' ? 'autosaving' : 'saving')

      try {
        const result = await saveProjectState({
          projectId,
          document: store.document,
          expectedRevision: store.revision,
        })

        if (result.conflict) {
          const isDirty = useEditorStore.getState().dirty
          if (isDirty && onConflict) {
            useEditorStore.getState().setSyncStatus('conflict')
            onConflict((choice) => {
              if (choice === 'reload') {
                void reloadFromCloud(projectId)
              } else {
                // Keep local: force-save by re-basing on the server's current revision.
                void resolveKeepLocal(projectId)
              }
            })
          } else {
            await reloadFromCloud(projectId)
          }
        } else {
          const s = useEditorStore.getState()
          s.setRevision(result.revision)
          s.setDirty(false)
          s.setSyncStatus('synced')
          await clearDraft(projectId)
        }
      } catch {
        // Draft stays in IndexedDB; next change re-triggers a save attempt.
        useEditorStore.getState().setSyncStatus('save-failed')
      } finally {
        saving.current = false
      }
    },
    [projectId, onConflict],
  )

  // Watch dirty flag → schedule draft + cloud save.
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.document === prev.document) return

      if (draftTimer.current) window.clearTimeout(draftTimer.current)
      draftTimer.current = window.setTimeout(() => {
        const s = useEditorStore.getState()
        s.setSyncStatus('local')
        void saveDraft({
          projectId,
          document: s.document,
          baseRevision: s.revision,
          updatedAt: Date.now(),
        })
      }, LOCAL_DRAFT_DEBOUNCE_MS)

      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void saveNow(), AUTOSAVE_DEBOUNCE_MS)
    })
    return () => {
      unsub()
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [projectId, saveNow])

  // Automatic snapshots while dirty. Skips duplicates, prunes old ones.
  useEffect(() => {
    snapshotTimer.current = window.setInterval(() => {
      const s = useEditorStore.getState()
      if (!s.dirty) return
      const json = JSON.stringify(s.document)
      if (json === lastSnapshotJson.current) return
      lastSnapshotJson.current = json
      void createVersion({
        projectId,
        name: null,
        kind: 'automatic',
        snapshot: s.document,
      })
        .then(() => pruneAutomaticVersions(projectId, 10))
        .catch(() => undefined)
    }, AUTO_SNAPSHOT_INTERVAL_MS)
    return () => {
      if (snapshotTimer.current) window.clearInterval(snapshotTimer.current)
    }
  }, [projectId])

  const loadProject = useCallback(async () => {
    const store = useEditorStore.getState()

    // 1) cloud state (authoritative)
    const stateRow = await getProjectState(projectId)

    // 2) known assets — merge storage rows so reopened projects know their
    //    object keys even if the last autosave happened before upload finished.
    const assetRows = await listAssets(projectId).catch(() => [])

    if (stateRow) {
      const parsed = parseDocument(stateRow.document)
      if (parsed.ok) {
        mergeAssetRows(parsed.document, assetRows)
        store.loadDocument(parsed.document, stateRow.revision)

        // 3) unsynced local draft wins only if it changed after the cloud save
        const draft = await loadDraft(projectId)
        if (draft && draft.baseRevision === stateRow.revision) {
          const draftParsed = parseDocument(draft.document)
          if (draftParsed.ok) {
            mergeAssetRows(draftParsed.document, assetRows)
            store.loadDocument(draftParsed.document, stateRow.revision)
            useEditorStore.getState().mutate((doc) => {
              Object.assign(doc, draftParsed.document)
            })
            useEditorStore.getState().setSyncStatus('local')
            useEditorStore.getState().setDirty(true)
          }
        }
        return { source: 'cloud' as const }
      }
    }

    // No valid cloud state; fall back to draft, else keep a fresh document.
    const draft = await loadDraft(projectId)
    if (draft) {
      const draftParsed = parseDocument(draft.document)
      if (draftParsed.ok) {
        store.loadDocument(draftParsed.document, draft.baseRevision)
        useEditorStore.getState().setDirty(true)
        useEditorStore.getState().setSyncStatus('local')
        return { source: 'draft' as const }
      }
    }
    store.resetDocument()
    return { source: 'empty' as const }
  }, [projectId])

  const saveManualSnapshot = useCallback(
    async (name: string) => {
      const s = useEditorStore.getState()
      // Ensure the latest state is in cloud first, then snapshot it.
      await saveNow('manual')
      await createVersion({
        projectId,
        name: name || null,
        kind: 'manual',
        snapshot: s.document,
      })
    },
    [projectId, saveNow],
  )

  return { loadProject, saveNow, saveManualSnapshot }
}

function mergeAssetRows(
  doc: import('@/types/editor').EditorDocument,
  rows: import('@/lib/api').ProjectAssetRow[],
) {
  const byChecksum = new Map(rows.map((r) => [r.checksum, r]))
  for (const asset of Object.values(doc.assets)) {
    const row = byChecksum.get(asset.checksum)
    if (row && row.object_key && row.upload_status === 'ready') {
      asset.objectKey = row.object_key
      asset.status = 'ready'
      asset.uploadProgress = 100
    }
  }
}

async function reloadFromCloud(projectId: string) {
  const row = await getProjectState(projectId)
  if (!row) return
  const parsed = parseDocument(row.document)
  if (!parsed.ok) return
  useEditorStore.getState().loadDocument(parsed.document, row.revision)
  await clearDraft(projectId)
}

async function resolveKeepLocal(projectId: string) {
  const row = await getProjectState(projectId)
  if (!row) return
  const store = useEditorStore.getState()
  store.setRevision(row.revision)
  // Next save will apply on top of the server revision; local changes win.
  store.setSyncStatus('unsaved')
  store.setDirty(true)
}
