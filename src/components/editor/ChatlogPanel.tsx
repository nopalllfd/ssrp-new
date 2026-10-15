import { useMemo, useRef, useState, type DragEvent } from 'react'
import { Upload, X, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/misc'
import { ApplyChatlogDialog } from '@/components/editor/ApplyChatlogDialog'
import { parseChatlogLines } from '@/lib/chatlog'
import { useEditorStore } from '@/store/editor'

/** Panel tab Chatlog: unggah .txt, preview isinya, dan tombol terapkan ke gambar. */
export function ChatlogPanel() {
  const chatlog = useEditorStore((s) => s.chatlog)
  const setChatlog = useEditorStore((s) => s.setChatlog)
  const document = useEditorStore((s) => s.document)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [appliedInfo, setAppliedInfo] = useState<string | null>(null)

  const lines = useMemo(
    () => (chatlog ? parseChatlogLines(chatlog.content) : []),
    [chatlog],
  )

  const imageCount = useMemo(() => {
    const overlayAssetIds = new Set<string>()
    for (const l of document.layers) {
      if (l.type === 'image' && l.ownerAssetId) overlayAssetIds.add(l.assetId)
    }
    return Object.keys(document.assets).filter(
      (id) =>
        !overlayAssetIds.has(id) &&
        document.layers.some((l) => l.type === 'image' && l.assetId === id && !l.ownerAssetId),
    ).length
  }, [document])

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setError(null)
    setAppliedInfo(null)

    if (!file.name.toLowerCase().endsWith('.txt')) {
      setError('Ekstensi harus .txt.')
      return
    }

    const content = await file.text()
    if (parseChatlogLines(content).length === 0) {
      setError('File kosong atau tidak berisi kalimat.')
      return
    }
    setChatlog({ fileName: file.name, content })
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    await handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h3 className="text-sm font-semibold">Chatlog</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Unggah file <code>.txt</code> berisi chatlog, lalu terapkan ke gambar sebagai layer teks
          otomatis.
        </p>
      </div>

      {/* Area unggah */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,text/plain"
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => void handleDrop(e)}
        className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center transition-colors hover:border-primary/60 hover:bg-muted"
      >
        <Upload className="size-5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          Klik atau tarik file ke sini · hanya <strong>.txt</strong>
        </span>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Preview chatlog */}
      {chatlog && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs font-medium">{chatlog.fileName}</span>
              <Badge>{lines.length} kalimat</Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              title="Hapus chatlog"
              onClick={() => {
                setChatlog(null)
                setError(null)
                setAppliedInfo(null)
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="app-scrollbar max-h-64 overflow-y-auto rounded-md border border-border bg-background/60 p-2">
            {lines.map((line, i) => (
              <p key={i} className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                <span className="mr-1.5 select-none text-muted-foreground/60">{i + 1}.</span>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {appliedInfo && <p className="text-xs text-emerald-400">{appliedInfo}</p>}

      {/* Terapkan ke gambar */}
      <Button
        className="w-full"
        disabled={!chatlog || lines.length === 0 || imageCount === 0}
        onClick={() => {
          setAppliedInfo(null)
          setDialogOpen(true)
        }}
      >
        Terapkan ke gambar
      </Button>
      {imageCount === 0 && (
        <p className="text-xs text-muted-foreground">Belum ada gambar di kanvas.</p>
      )}

      {chatlog && (
        <ApplyChatlogDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          chatlogContent={chatlog.content}
          onApplied={(info) =>
            setAppliedInfo(
              `Berhasil: ${info.used} kalimat diterapkan ke ${info.images} gambar${
                info.total > info.used ? ` (${info.total - info.used} sisa diabaikan)` : ''
              }.`,
            )
          }
        />
      )}
    </div>
  )
}
