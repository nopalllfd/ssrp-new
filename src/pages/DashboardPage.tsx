import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Copy,
  FolderPlus,
  Heart,
  LayoutGrid,
  List as ListIcon,
  LogOut,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  User as UserIcon,
} from 'lucide-react'
import {
  createProject,
  deleteProjectForever,
  getProjectState,
  listProjects,
  renameProject,
  restoreProject,
  softDeleteProject,
  type ProjectRow,
} from '@/lib/api'
import { parseDocument } from '@/lib/editorDocument'
import { resolveAssetUrl } from '@/lib/images'
import type { ImageLayer } from '@/types/editor'
import logoUrl from '@/assets/logo.svg'
import { useAuth } from '@/store/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Dropdown, DropdownItem } from '@/components/ui/dropdown'
import { Select, Skeleton, Toggle } from '@/components/ui/misc'
import { formatDateTime } from '@/lib/utils'

type SortKey = 'updated' | 'name' | 'created'

export function DashboardPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [showTrash, setShowTrash] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<ProjectRow | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<ProjectRow | null>(null)

  const projectsQuery = useQuery({
    queryKey: ['projects', showTrash],
    queryFn: () => listProjects(showTrash),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['projects'] })

  const createMutation = useMutation({
    mutationFn: (name: string) => createProject(name),
    onSuccess: (row) => {
      invalidate()
      setCreateOpen(false)
      setNewName('')
      navigate(`/project/${row.id}`)
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameProject(id, name),
    onSuccess: () => {
      invalidate()
      setRenaming(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => softDeleteProject(id),
    onSuccess: () => {
      invalidate()
      setDeleting(null)
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreProject(id),
    onSuccess: invalidate,
  })

  const purgeMutation = useMutation({
    mutationFn: (id: string) => deleteProjectForever(id),
    onSuccess: invalidate,
  })

  const duplicateMutation = useMutation({
    mutationFn: async (project: ProjectRow) => {
      const copy = await createProject(`${project.name} copy`)
      return copy
    },
    onSuccess: invalidate,
  })

  const visible = useMemo(() => {
    const rows = projectsQuery.data ?? []
    const filtered = search.trim()
      ? rows.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
      : rows
    const sorted = [...filtered]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'created')
      sorted.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    if (sort === 'updated')
      sorted.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    return sorted
  }, [projectsQuery.data, search, sort])

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    user?.email ??
    'User'

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="Logo Yurchat" className="size-8 rounded-md" />
          <h1 className="text-xl font-semibold">Yurchat</h1>
          <span className="hidden rounded-full border border-border bg-accent/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline">
            Beta Release 1.0.0
          </span>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <a
            href="https://bagibagi.co/floppp"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Support developer"
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Heart className="size-3.5 text-red-500" />
            <span className="hidden md:inline">Support developer</span>
          </a>
          <Link to="/profile" className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent" aria-label="Profile">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex size-7 items-center justify-center rounded-full bg-secondary">
                <UserIcon className="size-4" />
              </span>
            )}
            <span className="hidden text-sm sm:inline">{displayName}</span>
          </Link>
          <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => void signOut()}>
            <LogOut />
          </Button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => setCreateOpen(true)}>
          <FolderPlus /> New project
        </Button>
        <div className="relative flex-1 min-w-44">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          className="w-32 sm:w-40"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort projects"
        >
          <option value="updated">Recently updated</option>
          <option value="name">Name</option>
          <option value="created">Creation date</option>
        </Select>
        <Button
          variant="outline"
          size="icon"
          aria-label="Toggle view"
          onClick={() => setView((v) => (v === 'grid' ? 'list' : 'grid'))}
        >
          {view === 'grid' ? <ListIcon /> : <LayoutGrid />}
        </Button>
        <Toggle checked={showTrash} onChange={setShowTrash} label="Trash" />
      </div>

      {/* Kartu tools */}
      {!showTrash && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => navigate('/ai-chatlog')}
            className="group rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent/60"
          >
            <span className="mb-2 flex size-9 items-center justify-center rounded-md bg-secondary text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Sparkles className="size-4" />
            </span>
            <p className="text-sm font-medium">AI Chatlog Tools</p>
            <p className="text-xs text-muted-foreground">
              Clean, filter, and extract RP chatlogs with AI.
            </p>
          </button>
        </div>
      )}

      {projectsQuery.isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}

      {projectsQuery.isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {(projectsQuery.error as Error).message}
        </div>
      )}

      {projectsQuery.data && visible.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center sm:p-12">
          <p className="text-lg font-medium">{showTrash ? 'Trash is empty' : 'No projects yet'}</p>
          {!showTrash && (
            <>
              <p className="text-sm text-muted-foreground">
                Buat project pertama Anda — mis. “Police Investigation RP”.
              </p>
              <Button onClick={() => setCreateOpen(true)}>
                <FolderPlus /> Create project
              </Button>
            </>
          )}
        </div>
      )}

      {visible.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              trashed={showTrash}
              onOpen={() => navigate(`/project/${p.id}`)}
              onRename={() => {
                setRenaming(p)
                setRenameValue(p.name)
              }}
              onDuplicate={() => duplicateMutation.mutate(p)}
              onDelete={() => setDeleting(p)}
              onRestore={() => restoreMutation.mutate(p.id)}
              onPurge={() => purgeMutation.mutate(p.id)}
            />
          ))}
        </div>
      )}

      {visible.length > 0 && view === 'list' && (
        // Tanpa overflow-hidden — agar menu dropdown baris terakhir tidak
        // terpotong. Sudut membulat diserahkan ke baris pertama/terakhir.
        <div className="rounded-lg border border-border">
          {visible.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0 first:rounded-t-lg last:rounded-b-lg hover:bg-accent/40"
            >
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer text-left"
                onClick={() => !showTrash && navigate(`/project/${p.id}`)}
              >
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  Updated {formatDateTime(p.updated_at)}
                </p>
              </button>
              <ProjectMenu
                project={p}
                trashed={showTrash}
                onRename={() => {
                  setRenaming(p)
                  setRenameValue(p.name)
                }}
                onDuplicate={() => duplicateMutation.mutate(p)}
                onDelete={() => setDeleting(p)}
                onRestore={() => restoreMutation.mutate(p.id)}
                onPurge={() => purgeMutation.mutate(p.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent title="New project" onClose={() => setCreateOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (newName.trim()) createMutation.mutate(newName.trim())
            }}
            className="flex flex-col gap-3"
          >
            <Input
              autoFocus
              placeholder="Project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={200}
            />
            <Button type="submit" disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
            {createMutation.isError && (
              <p className="text-xs text-destructive">
                {(createMutation.error as Error).message}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renaming} onOpenChange={() => setRenaming(null)}>
        <DialogContent title="Rename project" onClose={() => setRenaming(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (renaming && renameValue.trim()) {
                renameMutation.mutate({ id: renaming.id, name: renameValue.trim() })
              }
            }}
            className="flex flex-col gap-3"
          >
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={200}
            />
            <Button type="submit" disabled={!renameValue.trim() || renameMutation.isPending}>
              Save
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent title="Move to trash?" onClose={() => setDeleting(null)}>
          <p className="mb-4 text-sm text-muted-foreground">
            “{deleting?.name}” akan dipindahkan ke trash. Anda bisa memulihkannya kembali.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              Move to trash
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Ambil gambar (screenshot) pertama proyek sebagai thumbnail kartu dashboard.
 * Mengabaikan layer gambar overlay (ownerAssetId) dan layer tersembunyi.
 */
function useProjectThumbnail(
  projectId: string,
  enabled: boolean,
): { url: string | null; onImgError: () => void } {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['project-thumb', projectId],
    enabled,
    // Lebih singkat dari masa berlaku signed URL (10 menit) supaya URL yang
    // sudah kedaluwarsa tidak dipakai ulang dari cache.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      const state = await getProjectState(projectId)
      if (!state) return null
      const parsed = parseDocument(state.document)
      if (!parsed.ok) return null
      const doc = parsed.document
      const layer = doc.layers.find(
        (l): l is ImageLayer => l.type === 'image' && !l.ownerAssetId && l.visible,
      )
      const asset =
        (layer ? doc.assets[layer.assetId] : undefined) ?? Object.values(doc.assets)[0]
      if (!asset) return null
      return resolveAssetUrl(asset)
    },
  })
  const url = query.data ?? null

  // Revoke HANYA ketika URL diganti oleh data query baru — jangan saat
  // unmount. Selama URL masih tersimpan di cache query, ia akan dipakai lagi
  // saat kartu dirender ulang (toggle grid/list, buka-tutup trash, navigasi);
  // kalau sudah direvoke saat unmount, gambarnya gagal load dan thumbnail
  // jadi "hilang-muncul".
  const prevUrl = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevUrl.current
    prevUrl.current = url
    if (prev && prev !== url && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
  }, [url])

  // Jika <img> gagal load (mis. signed URL kedaluwarsa atau blob sempat
  // dilepas), minta URL baru — maksimal 2 kali supaya tidak loop; kalau tetap
  // gagal, URL ditandai broken dan kartu menampilkan placeholder.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const triedUrl = useRef<string | null>(null)
  const retries = useRef(0)
  const onImgError = useCallback(() => {
    if (!url) return
    if (triedUrl.current === url || retries.current >= 2) {
      setBrokenUrl(url)
      return
    }
    triedUrl.current = url
    retries.current += 1
    void queryClient.invalidateQueries({ queryKey: ['project-thumb', projectId] })
  }, [queryClient, projectId, url])

  return { url: url && brokenUrl !== url ? url : null, onImgError }
}

function ProjectCard(props: {
  project: ProjectRow
  trashed: boolean
  onOpen: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  onRestore: () => void
  onPurge: () => void
}) {
  const { project, trashed, onOpen } = props
  const { url: thumbUrl, onImgError } = useProjectThumbnail(project.id, !trashed)
  return (
    // Jangan pakai overflow-hidden di card: ia ikut memotong menu dropdown
    // (position absolute) yang keluar ke bawah card. Sudut membulat diserahkan
    // ke thumbnail di bawah ini.
    <div className="group rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => !trashed && onOpen()}
        className="block h-24 w-full cursor-pointer overflow-hidden rounded-t-lg bg-secondary/60"
        aria-label={`Open ${project.name}`}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={onImgError}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No thumbnail
          </div>
        )}
      </button>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{project.name}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(project.updated_at)}</p>
        </div>
        <ProjectMenu {...props} />
      </div>
    </div>
  )
}

function ProjectMenu(props: {
  project: ProjectRow
  trashed: boolean
  onOpen?: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  onRestore: () => void
  onPurge: () => void
}) {
  if (props.trashed) {
    return (
      <Dropdown align="right" trigger={<Button variant="ghost" size="icon"><MoreHorizontal /></Button>}>
        <DropdownItem onClick={props.onRestore}>
          <RotateCcw /> Restore
        </DropdownItem>
        <DropdownItem destructive onClick={props.onPurge}>
          <Trash2 /> Delete forever
        </DropdownItem>
      </Dropdown>
    )
  }
  return (
    <Dropdown align="right" trigger={<Button variant="ghost" size="icon"><MoreHorizontal /></Button>}>
      <DropdownItem onClick={props.onRename}>
        <Pencil /> Rename
      </DropdownItem>
      <DropdownItem onClick={props.onDuplicate}>
        <Copy /> Duplicate
      </DropdownItem>
      <DropdownItem destructive onClick={props.onDelete}>
        <Trash2 /> Move to trash
      </DropdownItem>
    </Dropdown>
  )
}
