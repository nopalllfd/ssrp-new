import { supabase } from '@/lib/supabase'
import type { EditorDocument } from '@/types/editor'

export interface ProjectRow {
  id: string
  user_id: string
  name: string
  thumbnail_key: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ProjectAssetRow {
  id: string
  project_id: string
  original_name: string | null
  mime_type: string | null
  file_size: number | null
  width: number | null
  height: number | null
  object_key: string | null
  upload_status: 'pending' | 'uploading' | 'ready' | 'error'
  checksum: string | null
  created_at: string
  updated_at: string
}

export interface ProjectStateRow {
  project_id: string
  document: unknown
  revision: number
  updated_at: string
}

export interface ProjectVersionRow {
  id: string
  project_id: string
  version_number: number
  name: string | null
  kind: 'automatic' | 'manual'
  snapshot: unknown
  created_at: string
}

export interface TemplateRow {
  id: string
  user_id: string | null
  name: string
  config: unknown
  is_public: boolean
  created_at: string
  updated_at: string
}

function must<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  return data as T
}

// ------------------------------------------------------------- projects

export async function listProjects(includeTrashed = false): Promise<ProjectRow[]> {
  let q = supabase.from('projects').select('*')
  q = includeTrashed ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null)
  const { data, error } = await q.order('updated_at', { ascending: false })
  return must(data, error) as ProjectRow[]
}

export async function getProject(id: string): Promise<ProjectRow> {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single()
  return must(data, error) as ProjectRow
}

export async function createProject(name: string): Promise<ProjectRow> {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) throw new Error(userErr.message)
  const userId = userData.user?.id
  if (!userId) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('projects')
    .insert({ name, user_id: userId })
    .select()
    .single()
  return must(data, error) as ProjectRow
}

export async function renameProject(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('projects').update({ name }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function softDeleteProject(id: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function restoreProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').update({ deleted_at: null }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteProjectForever(id: string): Promise<void> {
  // Children cascade. Storage objects are removed via removeProjectObjects.
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// --------------------------------------------------------------- assets

export async function listAssets(projectId: string): Promise<ProjectAssetRow[]> {
  const { data, error } = await supabase
    .from('project_assets')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  return must(data, error) as ProjectAssetRow[]
}

export async function createAssetRecord(input: {
  projectId: string
  originalName: string
  mimeType: string
  fileSize: number
  width: number
  height: number
  objectKey: string
  checksum: string
}): Promise<ProjectAssetRow> {
  // Retry-safe: a failed attempt may have already created a row with this
  // object_key (unique). Reuse it instead of inserting a duplicate.
  const { data: existing, error: findError } = await supabase
    .from('project_assets')
    .select('*')
    .eq('object_key', input.objectKey)
    .maybeSingle()
  if (findError) throw new Error(findError.message)
  if (existing) {
    await setAssetStatus(existing.id, 'pending')
    return existing as ProjectAssetRow
  }
  const { data, error } = await supabase
    .from('project_assets')
    .insert({
      project_id: input.projectId,
      original_name: input.originalName,
      mime_type: input.mimeType,
      file_size: input.fileSize,
      width: input.width,
      height: input.height,
      object_key: input.objectKey,
      checksum: input.checksum,
      upload_status: 'pending',
    })
    .select()
    .single()
  return must(data, error) as ProjectAssetRow
}

export async function setAssetStatus(
  id: string,
  status: ProjectAssetRow['upload_status'],
): Promise<void> {
  const { error } = await supabase
    .from('project_assets')
    .update({ upload_status: status })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteAssetRecord(id: string): Promise<void> {
  const { error } = await supabase.from('project_assets').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// --------------------------------------------------------------- states

export async function getProjectState(
  projectId: string,
): Promise<ProjectStateRow | null> {
  const { data, error } = await supabase
    .from('project_states')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as ProjectStateRow | null
}

/**
 * Optimistic-concurrency save. The update only applies when the stored
 * revision still equals `expectedRevision`; otherwise PostgREST returns an
 * empty result set and we surface a conflict to the caller.
 */
export async function saveProjectState(input: {
  projectId: string
  document: EditorDocument
  expectedRevision: number | null
}): Promise<{ revision: number; conflict: boolean }> {
  if (input.expectedRevision === null) {
    // First save: only insert; if a row already exists we conflict.
    const { data, error } = await supabase
      .from('project_states')
      .upsert(
        { project_id: input.projectId, document: input.document, revision: 1 },
        { onConflict: 'project_id', ignoreDuplicates: true },
      )
      .select('revision')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return { revision: 0, conflict: true }
    return { revision: 1, conflict: false }
  }
  const next = input.expectedRevision + 1
  const { data, error } = await supabase
    .from('project_states')
    .update({ document: input.document, revision: next })
    .eq('project_id', input.projectId)
    .eq('revision', input.expectedRevision)
    .select('revision')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return { revision: input.expectedRevision, conflict: true }
  return { revision: next, conflict: false }
}

// ------------------------------------------------------------- versions

export async function listVersions(projectId: string): Promise<ProjectVersionRow[]> {
  const { data, error } = await supabase
    .from('project_versions')
    .select('id, project_id, version_number, name, kind, created_at')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(50)
  return must(data, error) as ProjectVersionRow[]
}

export async function getVersionSnapshot(id: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('project_versions')
    .select('snapshot')
    .eq('id', id)
    .single()
  return must(data, error)
}

export async function createVersion(input: {
  projectId: string
  name: string | null
  kind: 'automatic' | 'manual'
  snapshot: EditorDocument
}): Promise<void> {
  // Next version number = max + 1, computed client-side under unique constraint.
  const { data, error } = await supabase
    .from('project_versions')
    .select('version_number')
    .eq('project_id', input.projectId)
    .order('version_number', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const latest = data?.[0]?.version_number as number | undefined
  const next = (latest ?? 0) + 1
  const { error: insErr } = await supabase.from('project_versions').insert({
    project_id: input.projectId,
    version_number: next,
    name: input.name,
    kind: input.kind,
    snapshot: input.snapshot,
  })
  if (insErr) throw new Error(insErr.message)
}

export async function pruneAutomaticVersions(
  projectId: string,
  keep: number,
): Promise<void> {
  const { data, error } = await supabase
    .from('project_versions')
    .select('id, version_number')
    .eq('project_id', projectId)
    .eq('kind', 'automatic')
    .order('version_number', { ascending: false })
  if (error) return
  const stale = (data ?? []).slice(keep)
  if (stale.length === 0) return
  const { error: delErr } = await supabase
    .from('project_versions')
    .delete()
    .in('id', stale.map((v) => v.id as string))
  if (delErr) throw new Error(delErr.message)
}

// ------------------------------------------------------------- templates

export async function listTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .order('updated_at', { ascending: false })
  return must(data, error) as TemplateRow[]
}

export async function createTemplate(input: {
  name: string
  config: unknown
  isPublic: boolean
}): Promise<TemplateRow> {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) throw new Error(userErr.message)
  if (!userData.user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('templates')
    .insert({
      user_id: userData.user.id,
      name: input.name,
      config: input.config,
      is_public: input.isPublic,
    })
    .select()
    .single()
  return must(data, error) as TemplateRow
}

export async function updateTemplate(
  id: string,
  input: { name?: string; config?: unknown; isPublic?: boolean },
): Promise<void> {
  const { error } = await supabase
    .from('templates')
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.config !== undefined ? { config: input.config } : {}),
      ...(input.isPublic !== undefined ? { is_public: input.isPublic } : {}),
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('templates').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------- activity log

export async function logActivity(input: {
  projectId?: string | null
  action: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  // Best effort — never block UX for logging failures.
  try {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return
    await supabase.from('activity_logs').insert({
      user_id: userData.user.id,
      project_id: input.projectId ?? null,
      action: input.action,
      metadata: input.metadata ?? null,
    })
  } catch {
    /* intentionally ignored */
  }
}
