import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Copy,
  Download,
  FileText,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge, Label, Textarea, Toggle } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import {
  FILTER_OPTIONS,
  MAX_INPUT_CHARS,
  MODE_OPTIONS,
  REASON_LABELS,
  RP_CATEGORIES,
  classifyChunk,
  defaultSettings,
  detectActors,
  runPipeline,
  splitChatlogLines,
  type PipelineResult,
  type ProcessSettings,
} from '@/lib/aiChatlog'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Cache draft antar kunjungan halaman AI Chatlog.
 *
 * Halaman unmount saat user menekan Back / pindah route, sehingga useState
 * biasa ikut hilang. Cache ini menyimpan chatlog, pengaturan, dan hasil yang
 * belum diekspor selama tab terbuka — data baru benar-benar terhapus ketika
 * user menekan Clear atau Reset session.
 */
const draftCache: Record<string, unknown> = {}

function draftState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (key in draftCache) return draftCache[key] as T
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })
  useEffect(() => {
    draftCache[key] = value
  }, [key, value])
  return [value, setValue]
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function AiChatlogPage() {
  // --- Input (draft — bertahan saat pindah halaman) ---
  const [inputText, setInputText] = draftState('inputText', '')
  const [fileName, setFileName] = draftState<string | null>('fileName', null)
  const [fileSize, setFileSize] = draftState<number | null>('fileSize', null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- Konfigurasi (draft) ---
  const [settings, setSettings] = draftState('settings', defaultSettings)
  const [keywordText, setKeywordText] = draftState('keywordText', '')
  const [actorSearch, setActorSearch] = useState('')
  const [manualActor, setManualActor] = useState('')

  // --- Pemrosesan ---
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [processError, setProcessError] = useState<string | null>(null)

  // --- Hasil (draft) ---
  const [result, setResult] = draftState<PipelineResult | null>('result', null)
  const [outputText, setOutputText] = draftState('outputText', '')
  const [editing, setEditing] = draftState('editing', false)
  const [previewTab, setPreviewTab] = draftState<'after' | 'before'>('previewTab', 'after')
  const [showRemoved, setShowRemoved] = draftState('showRemoved', false)
  const [copied, setCopied] = useState<string | null>(null)

  const patch = (p: Partial<ProcessSettings>) => setSettings((s) => ({ ...s, ...p }))

  const lineCount = useMemo(
    () => (inputText ? splitChatlogLines(inputText).length : 0),
    [inputText],
  )
  const detectedActors = useMemo(
    () => (inputText ? detectActors(splitChatlogLines(inputText), 40) : []),
    [inputText],
  )
  const filteredDetected = useMemo(() => {
    const q = actorSearch.trim().toLowerCase()
    return q ? detectedActors.filter((a) => a.name.toLowerCase().includes(q)) : detectedActors
  }, [detectedActors, actorSearch])

  const outputLineCount = outputText === '' ? 0 : outputText.split('\n').length

  // --- Aksi input ---

  async function handleFile(file: File) {
    setInputError(null)
    const isTxt = /\.txt$/i.test(file.name) || file.type === 'text/plain' || file.type === ''
    if (!isTxt) {
      setInputError('Format tidak didukung. Gunakan file .txt.')
      return
    }
    if (file.size === 0) {
      setInputError('File kosong — tidak ada isi untuk diproses.')
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      setInputError('Gagal membaca file. Coba upload ulang.')
      return
    }
    if (!text.trim()) {
      setInputError('File tidak berisi teks.')
      return
    }
    if (text.length > MAX_INPUT_CHARS) {
      setInputError(
        `Chatlog terlalu besar (${text.length.toLocaleString('id-ID')} karakter, batas ${MAX_INPUT_CHARS.toLocaleString('id-ID')}). File TIDAK dipotong — gunakan chatlog yang lebih kecil.`,
      )
      return
    }
    setInputText(text)
    setFileName(file.name)
    setFileSize(file.size)
    setResult(null)
    setOutputText('')
    setProcessError(null)
  }

  function clearInput() {
    setInputText('')
    setFileName(null)
    setFileSize(null)
    setInputError(null)
    setResult(null)
    setOutputText('')
    setProcessError(null)
    setEditing(false)
  }

  function resetSession() {
    clearInput()
    setSettings(defaultSettings())
    setActorSearch('')
    setManualActor('')
    setKeywordText('')
    setProgress({ done: 0, total: 0 })
    setPreviewTab('after')
    setShowRemoved(false)
    setCopied(null)
  }

  // --- Aksi actor ---

  function toggleActor(name: string) {
    patch({
      actors: settings.actors.includes(name)
        ? settings.actors.filter((a) => a !== name)
        : [...settings.actors, name],
    })
  }

  function addManualActor() {
    const name = manualActor.trim()
    if (!name) return
    if (!settings.actors.includes(name)) patch({ actors: [...settings.actors, name] })
    setManualActor('')
  }

  // --- Pemrosesan ---

  async function handleProcess() {
    setProcessError(null)
    setCopied(null)
    if (!inputText.trim()) {
      setInputError('Upload atau tempel chatlog terlebih dahulu.')
      return
    }
    if (inputText.length > MAX_INPUT_CHARS) {
      setInputError(
        `Input melebihi batas ${MAX_INPUT_CHARS.toLocaleString('id-ID')} karakter. File tidak dipotong — proses dibatalkan.`,
      )
      return
    }
    if (
      settings.mode === 'extract' &&
      settings.actors.length === 0 &&
      settings.categories.length === 0 &&
      !settings.instruction.trim() &&
      !settings.customTopic.trim()
    ) {
      setProcessError(
        'Extract Specific RP butuh minimal satu actor, kategori RP, atau instruksi agar tahu apa yang harus diekstrak.',
      )
      return
    }
    setInputError(null)
    setResult(null)
    setOutputText('')
    setEditing(false)
    setPreviewTab('after')
    setShowRemoved(false)
    setProcessing(true)
    setProgress({ done: 0, total: 0 })
    try {
      const res = await runPipeline(inputText, settings, classifyChunk, (done, total) =>
        setProgress({ done, total }),
      )
      setResult(res)
      setOutputText(res.output)
    } catch (err) {
      setProcessError(
        err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses chatlog.',
      )
    } finally {
      setProcessing(false)
    }
  }

  // --- Aksi hasil ---

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(outputText)
      setCopied('Berhasil disalin ke clipboard.')
    } catch {
      setCopied('Gagal menyalin — pilih teks secara manual.')
    }
  }

  function downloadOutput() {
    const blob = new Blob([outputText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = fileName ? fileName.replace(/\.txt$/i, '') : 'chatlog'
    a.href = url
    a.download = `${base}_filtered.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const progressPct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-4 py-8">
      {/* 1. Header */}
      <header>
        <Link to="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft /> Dashboard
          </Button>
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-5 text-primary" /> AI Chatlog Tools
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Clean, filter, and extract RP chatlogs with AI. Dialog asli dipertahankan — AI hanya
          mengklasifikasi baris, tidak pernah menulis ulang.
        </p>
      </header>

      {/* 2. Input chatlog */}
      <SectionCard
        title="Chatlog input"
        description="Upload file .txt atau tempel chatlog langsung. Input asli tidak pernah diubah."
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return
              e.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragActive(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void handleFile(file)
            }}
            className={cn(
              'flex min-w-56 flex-1 items-center gap-2 rounded-md border border-dashed px-3 py-2 transition-colors',
              dragActive ? 'border-primary bg-primary/5' : 'border-border',
            )}
          >
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload /> {inputText ? 'Replace file' : 'Upload .txt'}
            </Button>
            <span className="text-xs text-muted-foreground">
              {dragActive ? 'Lepaskan file untuk memuat chatlog…' : 'atau drag & drop file .txt di sini'}
            </span>
          </div>
          {inputText && (
            <Button variant="ghost" size="sm" onClick={clearInput}>
              <Trash2 /> Clear
            </Button>
          )}
        </div>

        <Textarea
          rows={8}
          placeholder={'[20:10:01] Darren Kavanagh says: You joining the race tonight?\n…'}
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value)
            setInputError(null)
          }}
          className="font-mono text-xs"
        />

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {fileName && (
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3.5" /> {fileName}
            </span>
          )}
          {fileSize !== null && <span>{formatBytes(fileSize)}</span>}
          <span>{lineCount.toLocaleString('id-ID')} baris</span>
          <span>{inputText.length.toLocaleString('id-ID')} karakter</span>
        </div>
        {inputError && <p className="mt-2 text-xs text-destructive">{inputError}</p>}
      </SectionCard>

      {/* 3. Filtering mode */}
      <SectionCard title="Filtering mode" description="Pilih cara memproses chatlog.">
        <div className="grid gap-2 sm:grid-cols-3">
          {MODE_OPTIONS.map((mode) => (
            <button
              key={mode.key}
              type="button"
              onClick={() => patch({ mode: mode.key })}
              className={cn(
                'cursor-pointer rounded-md border p-3 text-left transition-colors',
                settings.mode === mode.key
                  ? 'border-primary bg-accent'
                  : 'border-border hover:bg-accent/50',
              )}
            >
              <p className="text-sm font-medium">{mode.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{mode.description}</p>
            </button>
          ))}
        </div>
      </SectionCard>

      {/* 4. RP direction & instruksi */}
      <SectionCard
        title="RP direction & custom instructions"
        description="Kategori RP dan instruksi bahasa alami untuk mengarahkan ekstraksi."
      >
        <div className="flex flex-wrap gap-2">
          {RP_CATEGORIES.map((cat) => {
            const active = settings.categories.includes(cat.key)
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() =>
                  patch({
                    categories: active
                      ? settings.categories.filter((k) => k !== cat.key)
                      : [...settings.categories, cat.key],
                  })
                }
                className={cn(
                  'cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                {cat.label}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <Label htmlFor="custom_topic">Custom topic (opsional)</Label>
          <Input
            id="custom_topic"
            placeholder="mis. negosiasi properti di Idlewood"
            value={settings.customTopic}
            onChange={(e) => patch({ customTopic: e.target.value })}
            maxLength={300}
          />
          <Label htmlFor="instruction" className="mt-1">
            Natural-language instruction
          </Label>
          <Textarea
            id="instruction"
            rows={3}
            placeholder="mis. Keep all dialogue involving Darren Kavanagh and John Doe about their upcoming street race. Preserve relevant replies from other characters in the same conversation. Remove advertisements, server notifications, and unrelated scenes."
            value={settings.instruction}
            onChange={(e) => patch({ instruction: e.target.value })}
            className="text-xs"
          />
        </div>
      </SectionCard>

      {/* 5. Actor selection */}
      <SectionCard
        title="Actor selection"
        description="Pilih karakter yang harus muncul di hasil. Nama dideteksi otomatis dari chatlog."
      >
        {settings.actors.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {settings.actors.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-accent px-2.5 py-1 text-xs"
              >
                {name}
                <button
                  type="button"
                  aria-label={`Hapus ${name}`}
                  onClick={() => toggleActor(name)}
                  className="cursor-pointer text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Cari nama actor…"
            value={actorSearch}
            onChange={(e) => setActorSearch(e.target.value)}
            className="w-48"
            aria-label="Cari nama actor"
          />
          <Input
            placeholder="Tambah nama manual…"
            value={manualActor}
            onChange={(e) => setManualActor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addManualActor()
              }
            }}
            className="w-48"
            aria-label="Tambah actor manual"
          />
          <Button variant="outline" size="sm" onClick={addManualActor} disabled={!manualActor.trim()}>
            Add
          </Button>
        </div>

        {filteredDetected.length > 0 ? (
          <div className="mt-3 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
            {filteredDetected.map((actor) => {
              const active = settings.actors.includes(actor.name)
              return (
                <button
                  key={actor.name}
                  type="button"
                  onClick={() => toggleActor(actor.name)}
                  className={cn(
                    'cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                >
                  {actor.name} · {actor.count}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {inputText ? 'Tidak ada nama terdeteksi — tambahkan manual jika perlu.' : 'Deteksi muncul setelah chatlog dimasukkan.'}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <Toggle
            checked={settings.includeReplies}
            disabled={settings.onlySelectedActors || settings.actors.length === 0}
            onChange={(v) => patch({ includeReplies: v })}
            label="Sertakan balasan relevan dari pihak lain dalam percakapan yang sama"
          />
          <Toggle
            checked={settings.onlySelectedActors}
            disabled={settings.actors.length === 0}
            onChange={(v) =>
              patch(v ? { onlySelectedActors: true, includeReplies: false } : { onlySelectedActors: false })
            }
            label="Hanya pesan yang dibuat oleh actor terpilih"
          />
        </div>
      </SectionCard>

      {/* 6. Content exclusion */}
      <SectionCard
        title="Content exclusion settings"
        description="Tiap toggle di bawah mengontrol apakah kategori konten itu DIHAPUS atau DIPERTAHANKAN dari hasil."
      >
        <ul className="mb-3 space-y-0.5 text-xs text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Toggle nyala (bercentang)</span> → semua
            baris yang tergolong kategori ini <span className="font-medium">dihapus</span> dari
            hasil. Contoh: centang “OOC conversations” berarti baris OOC dibuang.
          </li>
          <li>
            <span className="font-medium text-foreground">Toggle mati</span> → kategori ini{' '}
            <span className="font-medium">diabaikan</span>: barisnya dibiarkan lewat dan biarkan AI
            yang menilai dari konteks.
          </li>
          <li>
            AI hanya menghapus baris yang memang cocok — baris RP bermakna tidak dihapus hanya
            karena mengandung satu kata kunci filter.
          </li>
        </ul>
        <div className="grid gap-2 sm:grid-cols-2">
          {FILTER_OPTIONS.map((filter) => (
            <label
              key={filter.key}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 hover:bg-accent/50"
            >
              <input
                type="checkbox"
                checked={settings.filters[filter.key]}
                onChange={(e) =>
                  patch({ filters: { ...settings.filters, [filter.key]: e.target.checked } })
                }
                className="mt-0.5 size-4 cursor-pointer accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium">{filter.label}</span>
                <span className="block text-[11px] text-muted-foreground">{filter.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {settings.filters.customKeywords && (
          <div className="mt-3 flex flex-col gap-2">
            <Label htmlFor="custom_keywords">Custom keywords (pisahkan dengan koma)</Label>
            <Input
              id="custom_keywords"
              placeholder="mis. iklan toko, giveaway, donasi"
              value={keywordText}
              onChange={(e) => {
                setKeywordText(e.target.value)
                patch({
                  customExclusions: e.target.value
                    .split(/[,;\n]/)
                    .map((k) => k.trim())
                    .filter(Boolean),
                })
              }}
            />
          </div>
        )}
      </SectionCard>

      {/* 7. Timestamp settings */}
      <SectionCard
        title="Timestamp settings"
        description="Timestamp dihapus secara deterministik (regex) dari semua baris tersimpan — terlepas dari filtering AI."
      >
        <Toggle
          checked={settings.keepTimestamps}
          onChange={(v) => patch({ keepTimestamps: v })}
          label="Keep Timestamps"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {settings.keepTimestamps
            ? 'Timestamp akan dipertahankan di output dan file yang diunduh.'
            : 'Default: timestamp seperti [20:10:01], [2026-10-15 20:10:01], dan 20:10:01 dihapus, termasuk baris yang hanya berisi timestamp. Angka di dalam dialog tidak disentuh.'}
        </p>
      </SectionCard>

      {/* 8. Proses + progres */}
      <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void handleProcess()} disabled={processing || !inputText.trim()}>
            <Sparkles /> {processing ? 'Processing…' : 'Process with AI'}
          </Button>
          {processing && (
            <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
              Memproses potongan {progress.done}/{progress.total || '…'}
            </span>
          )}
        </div>

        {processing && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {processError && <p className="mt-3 text-xs text-destructive">{processError}</p>}

        <p className="mt-3 text-[11px] text-muted-foreground">
          Privasi: saat diproses, isi chatlog dikirim ke server aplikasi lalu diteruskan ke OpenAI
          untuk klasifikasi. Chatlog tidak disimpan permanen oleh aplikasi dan tidak dicatat ke log.
        </p>
      </div>

      {/* 9–11. Hasil, preview, aksi */}
      {result && (
        <>
          <SectionCard title="Results">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <StatBox label="Original" value={result.stats.originalLines} />
              <StatBox label="Retained" value={outputLineCount} />
              <StatBox
                label="Removed"
                value={Math.max(0, result.stats.originalLines - outputLineCount)}
              />
              <StatBox label="Actors" value={result.stats.actorsDetected} />
              <div className="rounded-md border border-border p-2 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</p>
                <Badge
                  className={
                    result.stats.status === 'complete'
                      ? 'mt-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                      : 'mt-1 border-amber-500/40 bg-amber-500/10 text-amber-600'
                  }
                >
                  {result.stats.status === 'complete' ? 'Complete' : 'Partial'}
                </Badge>
              </div>
            </div>

            {result.warnings.length > 0 && (
              <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <p className="text-xs font-medium text-destructive">Peringatan pemrosesan:</p>
                <ul className="mt-1 list-inside list-disc text-xs text-destructive">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Preview before/after */}
            <div className="mt-4 flex items-center gap-2">
              <div className="inline-flex rounded-md border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => setPreviewTab('after')}
                  className={cn(
                    'cursor-pointer rounded px-3 py-1 text-xs',
                    previewTab === 'after' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  After ({outputLineCount})
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('before')}
                  className={cn(
                    'cursor-pointer rounded px-3 py-1 text-xs',
                    previewTab === 'before' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  Before ({result.stats.originalLines})
                </button>
              </div>
            </div>

            {previewTab === 'before' ? (
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background/50 p-3 font-mono text-xs">
                {inputText || '(kosong)'}
              </pre>
            ) : editing ? (
              <Textarea
                rows={14}
                value={outputText}
                onChange={(e) => setOutputText(e.target.value)}
                className="mt-3 font-mono text-xs"
                aria-label="Edit hasil"
              />
            ) : (
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background/50 p-3 font-mono text-xs">
                {outputText || '(kosong — semua baris terhapus)'}
              </pre>
            )}

            {/* Alasan penghapusan (opsional) */}
            <div className="mt-3">
              <Toggle
                checked={showRemoved}
                onChange={setShowRemoved}
                label={`Tampilkan baris yang dihapus (${result.removed.length})`}
              />
              {showRemoved && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border p-2">
                  {result.removed.length === 0 ? (
                    <p className="p-1 text-xs text-muted-foreground">Tidak ada baris yang dihapus.</p>
                  ) : (
                    result.removed.slice(0, 300).map((line) => (
                      <div key={line.id} className="border-b border-border/50 py-1.5 last:border-b-0">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Baris {line.id + 1} · {REASON_LABELS[line.reason]}
                          {line.note ? ` · ${line.note}` : ''}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {line.text || '(kosong)'}
                        </p>
                      </div>
                    ))
                  )}
                  {result.removed.length > 300 && (
                    <p className="p-1 text-[11px] text-muted-foreground">
                      …dan {result.removed.length - 300} baris lainnya.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Aksi */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void copyOutput()}>
                <Copy /> Copy
              </Button>
              <Button variant="outline" size="sm" onClick={downloadOutput}>
                <Download /> Download .txt
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
                <Pencil /> {editing ? 'Selesai edit' : 'Edit result'}
              </Button>
              <Button variant="outline" size="sm" disabled={processing} onClick={() => void handleProcess()}>
                <RotateCcw /> Reprocess
              </Button>
              <Button variant="ghost" size="sm" onClick={resetSession}>
                <Trash2 /> Reset session
              </Button>
            </div>
            {editing && (
              <p className="mt-2 text-xs text-muted-foreground">
                Mode edit aktif — perubahan Anda dipakai saat menyalin/mengunduh.
              </p>
            )}
            {copied && <p className="mt-2 text-xs text-muted-foreground">{copied}</p>}
          </SectionCard>
        </>
      )}
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-2 text-center">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value.toLocaleString('id-ID')}</p>
    </div>
  )
}
