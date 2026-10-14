import type { TextLayer, TextStyleOverride, TextStyleRange } from '@/types/editor'

/**
 * Helper rich text: meresolve styleRanges menjadi segmen bergaya,
 * menghitung layout multi-style dengan wrap + align, serta menjaga
 * ranges tetap valid saat text berubah.
 */

export interface CharStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: string
  fill: string
}

/** Warna otomatis untuk prosa roleplay — baris yang diawali `*`. */
export const AUTO_PURPLE = '#bc84d1'

export interface RichRun {
  text: string
  /** offset X relatif kiri box text */
  x: number
  /** offset Y relatif atas box text (baseline 'top') */
  y: number
  style: CharStyle
}

export interface RichLayout {
  runs: RichRun[]
  /** lebar baris terpanjang */
  width: number
  /** tinggi total */
  height: number
}

let measureCanvas: HTMLCanvasElement | null = null
let measureCtx: CanvasRenderingContext2D | null = null

/** Fallback penukaran sederhana bila canvas 2d tidak tersedia (test/jsdom). */
function measure(text: string, style: CharStyle): number {
  if (typeof document !== 'undefined') {
    try {
      if (!measureCanvas) {
        measureCanvas = document.createElement('canvas')
        measureCtx = measureCanvas.getContext('2d')
      }
      if (measureCtx) {
        measureCtx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`
        return measureCtx.measureText(text).width
      }
    } catch {
      // jsdom tanpa paket canvas: jatuh ke aproksimasi di bawah.
    }
  }
  return text.length * style.fontSize * 0.6
}

/** Gaya dasar dari layer tanpa override. */
export function baseStyleOf(layer: TextLayer): CharStyle {
  return {
    fontFamily: layer.fontFamily,
    fontSize: layer.fontSize,
    fontWeight: layer.fontWeight,
    fontStyle: layer.fontStyle,
    fill: layer.fill,
  }
}

function applyOverride(base: CharStyle, override: TextStyleOverride): CharStyle {
  return {
    fontFamily: override.fontFamily ?? base.fontFamily,
    fontSize: override.fontSize ?? base.fontSize,
    fontWeight: override.fontWeight ?? base.fontWeight,
    fontStyle: override.fontStyle ?? base.fontStyle,
    fill: override.fill ?? base.fill,
  }
}

function sameStyle(a: CharStyle, b: CharStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.fontStyle === b.fontStyle &&
    a.fill === b.fill
  )
}

/** Gaya ter-resolve untuk karakter pada indeks `index`. Range terakhir menang. */
function charStyleAt(base: CharStyle, ranges: TextStyleRange[], index: number): CharStyle {
  let style = base
  for (const range of ranges) {
    if (index >= range.start && index < range.end) style = applyOverride(style, range)
  }
  return style
}

/** Apakah baris tempat karakter `index` berada diawali `*`. */
function lineHasAsterisk(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  const lineEnd = text.indexOf('\n', index)
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
  return line.trimStart().startsWith('*')
}

/**
 * Prosa roleplay: SETIAP baris yang diawali `*` diwarnai ungu otomatis,
 * baris lain (mis. dialog setelah enter) tetap warna dasar. Override fill
 * dari user lewat styleRanges menang atas warna otomatis ini.
 */
function withAutoLineFill(
  text: string,
  ranges: TextStyleRange[],
  index: number,
  style: CharStyle,
): CharStyle {
  const overridden = ranges.some(
    (r) => index >= r.start && index < r.end && r.fill !== undefined,
  )
  if (overridden || !lineHasAsterisk(text, index)) return style
  return { ...style, fill: AUTO_PURPLE }
}

/**
 * Teks mencampur baris `*` dan baris biasa — warnanya per-baris sehingga
 * harus dirender lewat jalur rich text, bukan Konva.Text satu-warna.
 */
export function hasMixedAutoPurple(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  let starred = 0
  for (const line of lines) if (line.trimStart().startsWith('*')) starred += 1
  return starred > 0 && starred < lines.length
}

/**
 * Gaya efektif pada posisi karakter `index` — untuk menampilkan nilai kontrol
 * panel sesuai isi seleksi aktif.
 */
export function styleAt(
  layer: Pick<
    TextLayer,
    'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'fill'
  > & Partial<Pick<TextLayer, 'text'>>,
  ranges: TextStyleRange[],
  index: number,
): CharStyle {
  const style = charStyleAt(baseStyleOf(layer as TextLayer), ranges, index)
  return layer.text === undefined ? style : withAutoLineFill(layer.text, ranges, index, style)
}

/** Gabungkan karakter berurutan bergaya sama menjadi run. Pemecah per karakter '\n'. */
interface Segment {
  text: string
  style: CharStyle
  /** indeks karakter awal (code unit) di text penuh — untuk kestabilan posisi */
  start: number
  lineBreakAfter: boolean
}

function segmentize(text: string, base: CharStyle, ranges: TextStyleRange[]): Segment[] {
  const segments: Segment[] = []
  let current: Segment | null = null
  let prevLineBreak = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (ch === '\n') {
      if (current) {
        current.lineBreakAfter = true
        current = null
      } else {
        // Enter beruntun (atau teks diawali enter): tiap baris kosong
        // jadi segmen sendiri supaya ruang/tingginya ikut terhitung.
        segments.push({ text: '', style: { ...base }, start: i, lineBreakAfter: true })
      }
      prevLineBreak = true
      continue
    }
    // Tangkap surrogate pair sebagai satu unit render.
    let unit = ch
    if (ch >= '\ud800' && ch <= '\udbff' && i + 1 < text.length) {
      unit = ch + (text[i + 1] as string)
      i += 1
    }
    const style = withAutoLineFill(text, ranges, i, charStyleAt(base, ranges, i))
    if (current && !prevLineBreak && sameStyle(current.style, style)) {
      current.text += unit
    } else {
      const next: Segment = { text: unit, style, start: i - unit.length + 1, lineBreakAfter: false }
      current = next
      segments.push(next)
    }
    prevLineBreak = false
  }
  if (text.endsWith('\n')) {
    // baris kosong terakhir tetap dihitung tingginya
    segments.push({ text: '', style: { ...base }, start: text.length, lineBreakAfter: true })
  }
  if (segments.length === 0) {
    segments.push({ text: '', style: { ...base }, start: 0, lineBreakAfter: false })
  }
  return segments
}

interface Token {
  text: string
  style: CharStyle
  width: number
  /** tinggi kontribusi (fontSize) untuk perhitungan tinggi baris */
  height: number
}

/** Pecah segmen menjadi token kata (wrap mengikuti batas kata). */
function tokensOf(segment: Segment, letterSpacing: number): Token[] {
  const tokens: Token[] = []
  const parts = segment.text.match(/\S+|\s+/g) ?? []
  for (const part of parts) {
    const width = measure(part, segment.style) + letterSpacing * Math.max(0, part.length - 1)
    tokens.push({ text: part, style: segment.style, width, height: segment.style.fontSize })
  }
  return tokens
}

/**
 * Gambar runs hasil layoutRichText ke context canvas 2d mentah.
 * Dipakai bersama oleh node editor (sceneFunc) dan exporter.
 */
export function drawRichRuns(
  c: CanvasRenderingContext2D,
  layout: RichLayout,
  opts: { stroke?: string; strokeWidth?: number; letterSpacing?: number },
): void {
  const letterSpacing = opts.letterSpacing ?? 0
  const useStroke = !!opts.strokeWidth && opts.strokeWidth > 0 && !!opts.stroke
  c.save()
  c.textBaseline = 'top'
  c.textAlign = 'left'
  if (useStroke) {
    c.lineWidth = opts.strokeWidth!
    c.strokeStyle = opts.stroke!
    c.lineJoin = 'round'
  }
  for (const run of layout.runs) {
    const { style } = run
    c.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`
    c.fillStyle = style.fill
    if (!letterSpacing) {
      if (useStroke) c.strokeText(run.text, run.x, run.y)
      c.fillText(run.text, run.x, run.y)
      continue
    }
    // letterSpacing: gambar per karakter supaya jarak antar huruf akurat.
    let x = run.x
    for (const ch of run.text) {
      if (useStroke) c.strokeText(ch, x, run.y)
      c.fillText(ch, x, run.y)
      x += c.measureText(ch).width + letterSpacing
    }
  }
  c.restore()
}

/**
 * Hitung layout multi-style: teks hanya dipecah oleh enter (`\n`), tanpa
 * word-wrap — tiap baris memanjang mengikuti konten kalimatnya.
 * Align dihitung relatif lebar baris terlebar.
 */
export function layoutRichText(
  layer: Pick<
    TextLayer,
    | 'text'
    | 'fontFamily'
    | 'fontSize'
    | 'fontWeight'
    | 'fontStyle'
    | 'fill'
    | 'align'
    | 'lineHeight'
    | 'letterSpacing'
  >,
  ranges: TextStyleRange[],
): RichLayout {
  const base = baseStyleOf(layer as TextLayer)
  const segments = segmentize(layer.text, base, ranges)
  const letterSpacing = layer.letterSpacing
  const lineHeightFactor = layer.lineHeight

  interface Placed extends Token {
    x: number
    y: number
    lineHeightPx: number
  }

  const lines: Placed[][] = []
  let line: Placed[] = []
  let cursor = 0

  const flushLine = () => {
    // Baris kosong hasil enter beruntun tetap di-push: array token kosong
    // nanti dihitung tingginya dari fontSize dasar (ruang kosong valid).
    lines.push(line)
    line = []
    cursor = 0
  }

  for (const segment of segments) {
    for (const token of tokensOf(segment, letterSpacing)) {
      const isSpaces = /^\s+$/.test(token.text)
      // Spasi di awal baris tidak dirender (mirip word-wrap umum).
      if (isSpaces && cursor === 0) continue
      line.push({ ...token, x: 0, y: 0, lineHeightPx: 0 })
      cursor += token.width
    }
    if (segment.lineBreakAfter) flushLine()
  }
  if (line.length > 0 || lines.length === 0) flushLine()

  // Pass 1: lebar tiap baris → align dihitung relatif lebar terlebar.
  const lineWidths = lines.map((tokens) =>
    tokens.reduce((sum, t) => sum + t.width, 0),
  )
  const maxLineWidth = lineWidths.reduce((m, w) => Math.max(m, w), 0)

  const runs: RichRun[] = []
  let y = 0
  lines.forEach((tokens, index) => {
    const maxSize = tokens.reduce((m, t) => Math.max(m, t.height), base.fontSize)
    const lineHeightPx = maxSize * lineHeightFactor
    const lineWidth = lineWidths[index] ?? 0
    const alignOffset =
      layer.align === 'center'
        ? (maxLineWidth - lineWidth) / 2
        : layer.align === 'right'
          ? maxLineWidth - lineWidth
          : 0
    let x = alignOffset
    for (const token of tokens) {
      runs.push({ text: token.text, x, y, style: token.style })
      x += token.width
    }
    y += lineHeightPx
  })

  return { runs, width: maxLineWidth, height: y }
}

/**
 * Geser ranges setelah text berubah dari `oldText` ke `newText`.
 * Diff disederhanakan: common prefix + common suffix.
 */
export function shiftStyleRanges(
  ranges: TextStyleRange[],
  oldText: string,
  newText: string,
): TextStyleRange[] {
  let prefix = 0
  const maxPrefix = Math.min(oldText.length, newText.length)
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++

  let suffix = 0
  while (
    suffix < Math.min(oldText.length, newText.length) - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++
  }

  const oldMidEnd = oldText.length - suffix // akhir wilayah berubah di text lama
  const delta = newText.length - oldText.length

  const next: TextStyleRange[] = []
  for (const range of ranges) {
    let start = range.start
    let end = range.end
    // Posisi di dalam wilayah berubah dilipat ke awal wilayah (prefix).
    // Khusus penyisipan murni (wilayah lama kosong): range yang mulai pas di
    // titik sisip ikut bergeser, supaya text sisipan tidak masuk ke range.
    if (start > prefix || (delta > 0 && oldMidEnd === prefix && start === prefix)) {
      start = start >= oldMidEnd ? start + delta : prefix
    }
    if (end > prefix) end = end >= oldMidEnd ? end + delta : prefix
    next.push({ ...range, start, end })
  }
  return normalizeRanges(next, newText.length)
}

/** Clamp ke [0, textLength] dan buang range kosong/invalid. */
export function normalizeRanges(ranges: TextStyleRange[], textLength: number): TextStyleRange[] {
  const out: TextStyleRange[] = []
  for (const range of ranges) {
    const start = Math.max(0, Math.min(range.start, textLength))
    const end = Math.max(start, Math.min(range.end, textLength))
    if (end > start) out.push({ ...range, start, end })
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

/**
 * Terapkan override baru pada [start, end): potong ranges yang tumpang tindih,
 * lalu tambahkan range baru. Override lama di wilayah itu digantikan.
 */
export function applyStyleRange(
  ranges: TextStyleRange[],
  start: number,
  end: number,
  override: TextStyleOverride,
): TextStyleRange[] {
  const next: TextStyleRange[] = []
  for (const range of ranges) {
    if (range.end <= start || range.start >= end) {
      next.push(range)
      continue
    }
    if (range.start < start) next.push({ ...range, start: range.start, end: start })
    if (range.end > end) next.push({ ...range, start: end, end: range.end })
  }
  if (end > start) next.push({ start, end, ...override })
  next.sort((a, b) => a.start - b.start)
  return next
}
