import { useState } from 'react'
import { Images, RotateCcw } from 'lucide-react'
import { applyTextStyleToAllImages, useEditorStore } from '@/store/editor'
import { effectiveCrop, refitImageLayers } from '@/lib/editorDocument'
import { refitChatlogLayers } from '@/lib/chatlog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label, Select, Slider, Textarea, Toggle } from '@/components/ui/misc'
import { FONT_OPTIONS } from '@/lib/fonts'
import type { Layer, TextLayer, TextStyleOverride } from '@/types/editor'
import { applyStyleRange, shiftStyleRanges, styleAt } from '@/lib/richText'

export function PropertiesPanel() {
  const document = useEditorStore((s) => s.document)
  const selection = useEditorStore((s) => s.selection)
  const mutate = useEditorStore((s) => s.mutate)

  const updateLayers = (fn: (l: Layer) => void, coalesce = false) =>
    mutate((doc) => {
      for (const layer of doc.layers) {
        if (selection.includes(layer.id)) fn(layer)
      }
    }, { coalesce })

  const first = document.layers.find((l) => l.id === selection[0])
  // Text berukuran tetap (otomatis mengikuti konten) — hanya posisinya
  // yang diubah, tanpa kontrol width/height.
  const allTextSelected =
    selection.length > 0 &&
    document.layers
      .filter((l) => selection.includes(l.id))
      .every((l) => l.type === 'text')

  if (selection.length === 0) {
    // Canvas properties when nothing is selected.
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
        <h3 className="text-sm font-semibold">Canvas</h3>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Width"
            value={document.canvas.width}
            onChange={(v) =>
              mutate((doc) => {
                // Ukuran gambar TIDAK ikut mengecil — canvas hanya memotong
                // bagian yang menonjol (clip).
                doc.canvas.width = Math.max(16, Math.round(v))
                refitChatlogLayers(doc)
              }, { coalesce: true })
            }
          />
          <NumberField
            label="Height"
            value={document.canvas.height}
            onChange={(v) =>
              mutate((doc) => {
                doc.canvas.height = Math.max(16, Math.round(v))
                refitChatlogLayers(doc)
              }, { coalesce: true })
            }
          />
        </div>
        <ColorField
          label="Background"
          value={document.canvas.background}
          onChange={(v) =>
            mutate((doc) => {
              doc.canvas.background = v
            })
          }
        />
        <div className="mt-2 rounded-md border border-border p-2">
          <Toggle
            checked={document.applySameCropToAll}
            onChange={(v) =>
              mutate((doc) => {
                doc.applySameCropToAll = v
                refitImageLayers(doc)
                refitChatlogLayers(doc)
              })
            }
            label="Apply same crop to all"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Jika aktif, semua gambar memakai crop bersama (shared). Nonaktifkan
            untuk crop per-gambar.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <h3 className="text-sm font-semibold">
        {selection.length > 1 ? `${selection.length} layers selected` : first?.name ?? 'Layer'}
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={first?.x ?? 0} onChange={(v) => updateLayers((l) => (l.x = v), true)} />
        <NumberField label="Y" value={first?.y ?? 0} onChange={(v) => updateLayers((l) => (l.y = v), true)} />
        {!allTextSelected && (
          <NumberField label="W" value={first?.width ?? 0} onChange={(v) => updateLayers((l) => (l.width = Math.max(5, v)), true)} />
        )}
        {!allTextSelected && (
          <NumberField label="H" value={first?.height ?? 0} onChange={(v) => updateLayers((l) => (l.height = Math.max(5, v)), true)} />
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label>Rotation</Label>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{Math.round(first?.rotation ?? 0)}°</span>
            <ResetButton
              title="Reset rotation ke 0°"
              onClick={() => updateLayers((l) => (l.rotation = 0))}
            />
          </div>
        </div>
        <Slider
          min={-180}
          max={180}
          step={1}
          value={first?.rotation ?? 0}
          onChange={(e) => updateLayers((l) => (l.rotation = Number(e.target.value)), true)}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label>Opacity</Label>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {Math.round((first?.opacity ?? 1) * 100)}%
            </span>
            <ResetButton
              title="Reset opacity ke 100%"
              onClick={() => updateLayers((l) => (l.opacity = 1))}
            />
          </div>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={first?.opacity ?? 1}
          onChange={(e) => updateLayers((l) => (l.opacity = Number(e.target.value)), true)}
        />
      </div>

      {first?.type === 'text' && <TextControls layer={first} onChange={updateLayers} />}

      {first?.type === 'rect' && (
        <>
          <ColorField
            label="Fill"
            value={first.fill}
            onChange={(v) =>
              updateLayers((l) => {
                if (l.type === 'rect') l.fill = v
              })
            }
          />
          {(first.shape ?? 'rect') === 'rect' && (
            <NumberField
              label="Corner radius"
              value={first.cornerRadius}
              onChange={(v) =>
                updateLayers((l) => {
                  if (l.type === 'rect') l.cornerRadius = Math.max(0, v)
                }, true)
              }
            />
          )}
        </>
      )}

      {first?.type === 'image' && (
        <ImageCropInfo layerId={first.id} />
      )}
    </div>
  )
}

function TextControls({
  layer,
  onChange,
}: {
  layer: TextLayer
  onChange: (fn: (l: Layer) => void, coalesce?: boolean) => void
}) {
  const textSelection = useEditorStore((s) => s.textSelection)
  // Draft input angka Line height: field boleh kosong sementara saat diedit.
  const [lhDraft, setLhDraft] = useState<string | null>(null)
  // Seleksi karakter di editor inline milik layer ini (bila masih valid).
  const sel =
    textSelection && textSelection.layerId === layer.id && textSelection.end > textSelection.start
      ? {
          start: Math.min(textSelection.start, layer.text.length),
          end: Math.min(textSelection.end, layer.text.length),
        }
      : null
  const hasSel = !!sel && sel.end > sel.start

  const upd = (fn: (l: TextLayer) => void, coalesce = true) =>
    onChange((l) => {
      if (l.type === 'text') fn(l)
    }, coalesce)

  // Gaya per-properti: bila ada seleksi teks aktif, tulis ke styleRanges
  // (hanya rangkaian terseleksi); bila tidak, ubah properti seluruh layer.
  const applyProp = (
    override: TextStyleOverride,
    wholeLayer: (l: TextLayer) => void,
    coalesce = true,
  ) => {
    if (hasSel && sel) {
      upd((l) => {
        l.styleRanges = applyStyleRange(l.styleRanges ?? [], sel.start, sel.end, override)
      }, coalesce)
    } else {
      upd(wholeLayer, coalesce)
    }
  }

  // Nilai tampilan kontrol = gaya efektif pada awal seleksi.
  const shown = hasSel && sel ? styleAt(layer, layer.styleRanges ?? [], sel.start) : null
  // Line height dibulatkan 2 desimal supaya slider & input angka konsisten.
  const lh = Math.round(layer.lineHeight * 100) / 100

  // Salin seluruh gaya text ini ke SEMUA layer text di semua gambar.
  const applyStyleToAllImages = () => {
    const state = useEditorStore.getState()
    const src = state.document.layers.find((l) => l.id === layer.id)
    if (!src || src.type !== 'text') return
    state.mutate((doc) => applyTextStyleToAllImages(doc, src))
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <h4 className="text-xs font-semibold text-muted-foreground">Typography</h4>
      {hasSel && (
        <p className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
          Gaya berlaku untuk {sel.end - sel.start} karakter terseleksi di text ini
          (“{shorten(layer.text.slice(sel.start, sel.end))}”).
        </p>
      )}
      <div>
        <Label>Text (chatlog)</Label>
        <Textarea
          className="mt-1 min-h-40"
          value={layer.text}
          placeholder={'* Darren Kavanagh sedang mengocok kartu.\nDarren Kavanagh says: Contoh dialog di sini.'}
          onChange={(e) =>
            upd((l) => {
              // Geser ranges gaya mengikuti selisih text lama → baru.
              if (l.styleRanges?.length) {
                l.styleRanges = shiftStyleRanges(l.styleRanges, l.text, e.target.value)
              }
              l.text = e.target.value
            })
          }
        />
      </div>
      <div>
        <Label>Font family</Label>
        <Select
          className="mt-1"
          value={shown?.fontFamily ?? layer.fontFamily}
          onChange={(e) =>
            applyProp({ fontFamily: e.target.value }, (l) => (l.fontFamily = e.target.value), false)
          }
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField
          label="Size"
          value={shown?.fontSize ?? layer.fontSize}
          onChange={(v) => {
            const size = Math.max(4, v)
            applyProp({ fontSize: size }, (l) => (l.fontSize = size))
          }}
        />
        <div>
          <Label>Weight</Label>
          <Select
            className="mt-1"
            value={String(shown?.fontWeight ?? layer.fontWeight)}
            onChange={(e) => {
              const w = Number(e.target.value) as TextLayer['fontWeight']
              applyProp({ fontWeight: w }, (l) => (l.fontWeight = w), false)
            }}
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
            value={shown?.fontStyle ?? layer.fontStyle}
            onChange={(e) => {
              const s = e.target.value as 'normal' | 'italic'
              applyProp({ fontStyle: s }, (l) => (l.fontStyle = s), false)
            }}
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </Select>
        </div>
      </div>
      <div>
        <Label>Align</Label>
        <Select
          className="mt-1"
          value={layer.align}
          onChange={(e) => upd((l) => (l.align = e.target.value as TextLayer['align']), false)}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </Select>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label>Line height</Label>
          <span className="text-xs text-muted-foreground">{lh}</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider
            className="flex-1"
            min={0.5}
            max={3}
            step={0.05}
            value={lh}
            onChange={(e) => upd((l) => (l.lineHeight = Math.max(0.5, Number(e.target.value))))}
          />
          <Input
            className="w-16 shrink-0"
            type="number"
            min={0.5}
            step={0.05}
            value={lhDraft ?? String(lh)}
            onChange={(e) => {
              const raw = e.target.value
              setLhDraft(raw)
              if (raw.trim() === '') return
              const n = Number(raw)
              if (Number.isFinite(n)) upd((l) => (l.lineHeight = Math.max(0.5, n)))
            }}
            onBlur={() => setLhDraft(null)}
          />
        </div>
      </div>
      <ColorField
        label="Color"
        value={shown?.fill ?? layer.fill}
        onChange={(v) => applyProp({ fill: v }, (l) => (l.fill = v), false)}
      />
      <div className="grid grid-cols-2 gap-2">
        <ColorField
          label="Stroke"
          value={layer.stroke || '#000000'}
          onChange={(v) =>
            upd((l) => {
              l.stroke = v
              // Beri ketebalan awal agar stroke langsung terlihat.
              if (l.strokeWidth === 0) l.strokeWidth = 2
            }, false)
          }
        />
        <NumberField
          label="Stroke width"
          value={layer.strokeWidth}
          onChange={(v) =>
            upd((l) => {
              l.strokeWidth = Math.max(0, v)
              // Stroke tanpa warna tidak digambar; samakan dengan swatch default.
              if (l.strokeWidth > 0 && !l.stroke) l.stroke = '#000000'
            })
          }
        />
      </div>
      <div>
        <div className="mb-1 flex justify-between">
          <Label>Shadow blur</Label>
          <span className="text-xs text-muted-foreground">{layer.shadowBlur}</span>
        </div>
        <Slider
          min={0}
          max={40}
          step={1}
          value={layer.shadowBlur}
          onChange={(e) => upd((l) => (l.shadowBlur = Number(e.target.value)))}
        />
      </div>
      <div className="border-t border-border pt-3">
        <Button variant="secondary" size="sm" className="w-full" onClick={applyStyleToAllImages}>
          <Images /> Terapkan style ke semua gambar
        </Button>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Menyalin font, ukuran, warna, stroke & shadow text ini ke semua layer text di semua
          gambar. Warna ungu tetap otomatis: hanya text berawalan * yang jadi ungu.
        </p>
      </div>
    </div>
  )
}

function ImageCropInfo({ layerId }: { layerId: string }) {
  const document = useEditorStore((s) => s.document)
  const layer = document.layers.find((l) => l.id === layerId)
  if (!layer || layer.type !== 'image') return null
  const crop = effectiveCrop(layer, document)
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-xs font-medium">Crop</p>
      {crop ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Output {crop.outWidth}×{crop.outHeight} · fit {crop.fit}
          {layer.cropOverride ? ' · per-image override' : ' · shared'}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">No crop rule — original size.</p>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground">
        Atur lewat tombol “Crop” di toolbar atas.
      </p>
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
}) {
  // Draft lokal supaya field boleh kosong saat diedit; saat blur dikembalikan
  // ke nilai efektif (ter-clamp) dari store.
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0')
  return (
    <div>
      <Label>{label}</Label>
      <Input
        className="mt-1"
        type="number"
        step={step}
        value={shown}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          if (raw.trim() === '') return
          const n = Number(raw)
          if (Number.isFinite(n)) onChange(n)
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  )
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          className="h-9 w-10 cursor-pointer rounded-md border border-input bg-transparent"
          value={normalizeColor(value)}
          onChange={(e) => onChange(e.target.value)}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  )
}

function normalizeColor(v: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  }
  return '#000000'
}

/** Potong preview text seleksi agar muat di label panel. */
function shorten(s: string, max = 24): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Tombol ikon kecil untuk mengembalikan nilai kontrol ke kondisi normal. */
function ResetButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5 [&_svg]:size-3"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <RotateCcw />
    </Button>
  )
}
