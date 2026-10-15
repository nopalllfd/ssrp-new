import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label, Select, Slider } from '@/components/ui/misc'
import { ColorField, NumberField } from '@/components/editor/PropertiesPanel'
import { FONT_OPTIONS } from '@/lib/fonts'
import { cn } from '@/lib/utils'
import {
  applyChatlogToDocument,
  DEFAULT_CHATLOG_STYLE,
  parseChatlogLines,
  type ChatlogStyle,
} from '@/lib/chatlog'
import { useEditorStore } from '@/store/editor'

const STORAGE_KEY = 'yurchat.chatlog.style'

/** Preferensi style chatlog bertahan antar sesi (localStorage). */
function loadStoredStyle(): ChatlogStyle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CHATLOG_STYLE
    const parsed = JSON.parse(raw) as Partial<ChatlogStyle>
    return { ...DEFAULT_CHATLOG_STYLE, ...parsed }
  } catch {
    return DEFAULT_CHATLOG_STYLE
  }
}

function storeStyle(style: ChatlogStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(style))
  } catch {
    // localStorage penuh/di-block — preferensi hanya bertahan sesi ini, bukan fatal.
  }
}

interface ChatlogPreset {
  name: string
  style: Partial<ChatlogStyle>
}

/** Preset cepat di dialog apply — chip sekali klik, sisanya bisa diatur manual. */
const PRESETS: ChatlogPreset[] = [
  { name: 'Standar (5+5)', style: { ...DEFAULT_CHATLOG_STYLE } },
  {
    name: 'Padat (8+8)',
    style: { ...DEFAULT_CHATLOG_STYLE, topCount: 8, bottomCount: 8, fontSize: 20, lineHeight: 1.15 },
  },
  {
    name: 'Sedikit (3+3)',
    style: { ...DEFAULT_CHATLOG_STYLE, topCount: 3, bottomCount: 3, fontSize: 28 },
  },
  {
    name: 'Polos',
    style: { ...DEFAULT_CHATLOG_STYLE, strokeWidth: 0, shadowBlur: 0 },
  },
]

/** Tandai chip preset aktif jika seluruh field preset cocok dengan style saat ini. */
function isPresetActive(preset: Partial<ChatlogStyle>, style: ChatlogStyle): boolean {
  return (Object.keys(preset) as (keyof ChatlogStyle)[]).every(
    (key) => style[key] === preset[key],
  )
}

export function ApplyChatlogDialog({
  open,
  onOpenChange,
  chatlogContent,
  onApplied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatlogContent: string
  /** Dipanggil setelah apply sukses (dipakai panel untuk menampilkan info). */
  onApplied?: (info: { images: number; used: number; total: number }) => void
}) {
  const [style, setStyle] = useState<ChatlogStyle>(() => loadStoredStyle())
  const [error, setError] = useState<string | null>(null)
  const [lhDraft, setLhDraft] = useState<string | null>(null)
  // Awalnya collapse — user hanya melihat ringkasan, detail dibuka lewat panah.
  const [showDetails, setShowDetails] = useState(false)

  const document = useEditorStore((s) => s.document)
  const lines = useMemo(() => parseChatlogLines(chatlogContent), [chatlogContent])

  // Setiap dialog dibuka, kembali ke tampilan ringkas.
  useEffect(() => {
    if (open) setShowDetails(false)
  }, [open])

  const perImage = Math.max(0, style.topCount) + Math.max(0, style.bottomCount)
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

  const capacity = perImage * imageCount
  const leftover = Math.max(0, lines.length - capacity)

  const set = <K extends keyof ChatlogStyle>(key: K, value: ChatlogStyle[K]) =>
    setStyle((prev) => ({ ...prev, [key]: value }))

  const handleApply = () => {
    setError(null)
    if (lines.length === 0) {
      setError('Chatlog kosong — tidak ada kalimat untuk diterapkan.')
      return
    }
    if (imageCount === 0) {
      setError('Belum ada gambar di kanvas.')
      return
    }

    const store = useEditorStore.getState()
    let applied = 0
    store.mutate((doc) => {
      applied = applyChatlogToDocument(doc, lines, {
        ...style,
        topCount: Math.max(0, Math.round(style.topCount)),
        bottomCount: Math.max(0, Math.round(style.bottomCount)),
        margin: Math.max(0, style.margin),
        fontSize: Math.max(1, style.fontSize),
      })
    })
    store.setSelection([])
    storeStyle(style)
    onApplied?.({ images: applied, used: Math.min(lines.length, applied * perImage), total: lines.length })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        title="Terapkan chatlog ke gambar"
        onClose={() => onOpenChange(false)}
      >
        <div className="space-y-4">
          {/* Ringkasan singkat — tampil saat detail ditutup */}
          <div>
            <p className="text-sm text-card-foreground">
              {style.topCount} kalimat di atas + {style.bottomCount} kalimat di bawah kiri per
              gambar
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {lines.length} kalimat → {imageCount} gambar
              {leftover > 0 && (
                <span className="text-amber-400"> · {leftover} kalimat sisa diabaikan</span>
              )}
              {perImage > 0 && lines.length < capacity && (
                <span className="text-amber-400">
                  {' '}
                  · {imageCount - Math.ceil(lines.length / perImage)} gambar tanpa kalimat
                </span>
              )}
            </p>
          </div>

          {/* Preset cepat */}
          <div>
            <Label>Preset</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setStyle((prev) => ({ ...prev, ...p.style }))}
                  className={cn(
                    'cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors',
                    isPresetActive(p.style, style)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:text-card-foreground',
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* Pengaturan detail — collapse, dibuka lewat panah */}
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            className="flex w-full cursor-pointer items-center justify-between border-t border-border pt-3 text-xs font-medium text-muted-foreground transition-colors hover:text-card-foreground"
          >
            <span>Pengaturan detail{showDetails ? '' : ' (distribusi, font, warna & efek)'}</span>
            <ChevronDown className={cn('size-4 transition-transform', showDetails && 'rotate-180')} />
          </button>

          {showDetails && (
            <div className="space-y-4">
          {/* Distribusi kalimat */}
          <div className="grid grid-cols-3 gap-3">
            <NumberField
              label="Atas / gambar"
              value={style.topCount}
              onChange={(v) => set('topCount', Math.round(v))}
            />
            <NumberField
              label="Bawah / gambar"
              value={style.bottomCount}
              onChange={(v) => set('bottomCount', Math.round(v))}
            />
            <NumberField label="Margin (px)" value={style.margin} onChange={(v) => set('margin', v)} />
          </div>

          {/* Font */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Jenis font</Label>
              <Select
                className="mt-1"
                value={style.fontFamily}
                onChange={(e) => set('fontFamily', e.target.value)}
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </div>
            <NumberField
              label="Ukuran font (px)"
              value={style.fontSize}
              onChange={(v) => set('fontSize', v)}
            />
            <div>
              <Label>Weight</Label>
              <Select
                className="mt-1"
                value={style.fontWeight}
                onChange={(e) =>
                  set('fontWeight', Number(e.target.value) as ChatlogStyle['fontWeight'])
                }
              >
                {[400, 500, 600, 700, 800].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Style</Label>
              <Select
                className="mt-1"
                value={style.fontStyle}
                onChange={(e) =>
                  set('fontStyle', e.target.value as ChatlogStyle['fontStyle'])
                }
              >
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </Select>
            </div>
            <div>
              <Label>Perataan</Label>
              <Select
                className="mt-1"
                value={style.align}
                onChange={(e) => set('align', e.target.value as ChatlogStyle['align'])}
              >
                <option value="left">Kiri</option>
                <option value="center">Tengah</option>
                <option value="right">Kanan</option>
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Line height</Label>
                <input
                  type="number"
                  step={0.05}
                  min={0.5}
                  className="h-6 w-14 rounded-md border border-input bg-card px-1 text-right text-xs"
                  value={lhDraft ?? style.lineHeight}
                  onChange={(e) => {
                    setLhDraft(e.target.value)
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n > 0) set('lineHeight', n)
                  }}
                  onBlur={() => setLhDraft(null)}
                />
              </div>
              <Slider
                className="mt-2"
                min={0.5}
                max={3}
                step={0.05}
                value={style.lineHeight}
                onChange={(e) => set('lineHeight', Number(e.target.value))}
              />
            </div>
          </div>

          {/* Warna & efek */}
          <div className="grid grid-cols-2 gap-3">
            <ColorField label="Warna teks" value={style.fill} onChange={(v) => set('fill', v)} />
            <ColorField
              label="Warna stroke"
              value={style.stroke}
              onChange={(v) => set('stroke', v)}
            />
            <NumberField
              label="Ketebalan stroke"
              value={style.strokeWidth}
              onChange={(v) => set('strokeWidth', Math.max(0, v))}
            />
            <div>
              <div className="flex items-center justify-between">
                <Label>Shadow blur</Label>
                <span className="text-xs text-muted-foreground">{style.shadowBlur}px</span>
              </div>
              <Slider
                className="mt-2"
                min={0}
                max={20}
                step={1}
                value={style.shadowBlur}
                onChange={(e) => set('shadowBlur', Number(e.target.value))}
              />
            </div>
          </div>

            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button onClick={handleApply}>Terapkan</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
