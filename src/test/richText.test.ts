import { describe, expect, it } from 'vitest'
import {
  AUTO_PURPLE,
  applyStyleRange,
  hasMixedAutoPurple,
  layoutRichText,
  normalizeRanges,
  shiftStyleRanges,
  styleAt,
} from '@/lib/richText'
import { createEmptyDocument, migrateDocument, parseDocument } from '@/lib/editorDocument'
import { DEFAULT_TEXT_FILL, newTextLayer } from '@/store/editor'
import type { TextLayer, TextStyleRange } from '@/types/editor'

const base = (overrides: Partial<TextLayer> = {}): TextLayer =>
  newTextLayer({ text: 'halo dunia', ...overrides }) as TextLayer

describe('shiftStyleRanges', () => {
  const ranges: TextStyleRange[] = [{ start: 0, end: 4, fill: '#ff0000' }]

  it('menjaga range utuh saat edit terjadi setelahnya', () => {
    const next = shiftStyleRanges(ranges, 'halo dunia', 'halo dunia!')
    expect(next[0]).toMatchObject({ start: 0, end: 4 })
  })

  it('menggeser range saat text disisipkan sebelumnya', () => {
    const next = shiftStyleRanges(ranges, 'halo dunia', 'ok halo dunia')
    expect(next[0]).toMatchObject({ start: 3, end: 7 })
  })

  it('range yang seluruhnya terhapus ikut hilang', () => {
    const next = shiftStyleRanges(
      [{ start: 5, end: 10, fill: '#ff0000' }],
      'halo dunia',
      'halo',
    )
    expect(next).toHaveLength(0)
  })

  it('range di wilayah edit yang sebagian terhapus menyusut', () => {
    const next = shiftStyleRanges(
      [{ start: 0, end: 10, fill: '#ff0000' }],
      'halo dunia',
      'halo',
    )
    expect(next[0]).toMatchObject({ start: 0, end: 4 })
  })

  it('mempertahankan range yang mencakup wilayah edit', () => {
    const next = shiftStyleRanges(ranges, 'halo dunia', 'ha dunia')
    // 3 karakter tengah "halo" dihapus; range menyusut tapi tak hilang.
    expect(next[0]).toMatchObject({ start: 0, end: 2 })
  })

  it('clamp ke panjang text baru', () => {
    const next = shiftStyleRanges(
      [{ start: 8, end: 10, fill: '#ff0000' }],
      'halo dunia',
      'halo',
    )
    expect(next).toHaveLength(0)
  })
})

describe('applyStyleRange', () => {
  it('menambah range baru pada text tanpa style', () => {
    const next = applyStyleRange([], 0, 4, { fill: '#ff0000' })
    expect(next).toEqual([{ start: 0, end: 4, fill: '#ff0000' }])
  })

  it('memotong range lama yang tumpang tindih (kiri & kanan)', () => {
    const prev: TextStyleRange[] = [{ start: 0, end: 10, fill: '#ff0000' }]
    const next = applyStyleRange(prev, 3, 6, { fill: '#00ff00' })
    expect(next).toHaveLength(3)
    expect(next[0]).toMatchObject({ start: 0, end: 3, fill: '#ff0000' })
    expect(next[1]).toMatchObject({ start: 3, end: 6, fill: '#00ff00' })
    expect(next[2]).toMatchObject({ start: 6, end: 10, fill: '#ff0000' })
  })

  it('range lama yang sepenuhnya tertutup digantikan', () => {
    const prev: TextStyleRange[] = [{ start: 2, end: 4, fontSize: 40 }]
    const next = applyStyleRange(prev, 0, 10, { fill: '#0000ff' })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ start: 0, end: 10, fill: '#0000ff' })
  })

  it('selalu terurut berdasarkan start', () => {
    const prev: TextStyleRange[] = [{ start: 8, end: 10, fontSize: 20 }]
    const next = applyStyleRange(prev, 1, 3, { fontFamily: 'Georgia' })
    expect(next.map((r) => r.start)).toEqual([1, 8])
  })
})

describe('normalizeRanges', () => {
  it('clamp ke panjang text dan membuang range kosong', () => {
    const next = normalizeRanges(
      [
        { start: -5, end: 3 },
        { start: 8, end: 100 },
        { start: 4, end: 4 },
      ],
      10,
    )
    expect(next).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 10 },
    ])
  })
})

describe('styleAt', () => {
  it('mengembalikan gaya dasar tanpa ranges', () => {
    const l = base({ fill: '#ffffff' })
    expect(styleAt(l, [], 2).fill).toBe('#ffffff')
  })

  it('range terakhir menang saat bertumpuk', () => {
    const l = base()
    const s = styleAt(
      l,
      [
        { start: 0, end: 5, fill: '#ff0000' },
        { start: 2, end: 3, fill: '#00ff00' },
      ],
      2,
    )
    expect(s.fill).toBe('#00ff00')
  })

  it('override parsial mewarisi properti lain dari dasar', () => {
    const l = base({ fontSize: 32, fill: '#ffffff' })
    const s = styleAt(l, [{ start: 0, end: 5, fill: '#ff0000' }], 1)
    expect(s.fill).toBe('#ff0000')
    expect(s.fontSize).toBe(32)
  })
})

describe('auto-purple per baris (prosa * + baris biasa)', () => {
  const twoLine = '* Darren is waving his hand\nDarren says: Jancok'
  const secondLineIndex = twoLine.indexOf('Darren says') // baris ke-2

  it('baris diawali * ungu, baris setelah enter tetap dasar', () => {
    const l = base({ text: twoLine, fill: DEFAULT_TEXT_FILL })
    expect(styleAt(l, [], 3).fill).toBe(AUTO_PURPLE)
    expect(styleAt(l, [], secondLineIndex).fill).toBe(DEFAULT_TEXT_FILL)
  })

  it('layoutRichText memberi run ungu hanya untuk baris *', () => {
    const l = base({ text: twoLine, width: 1000, fill: DEFAULT_TEXT_FILL })
    const layout = layoutRichText(l, [])
    const fills = new Set(layout.runs.map((r) => r.style.fill))
    expect(fills.has(AUTO_PURPLE)).toBe(true)
    expect(fills.has(DEFAULT_TEXT_FILL)).toBe(true)
    // Tidak ada run baris kedua yang berwarna ungu.
    const secondLineRuns = layout.runs.filter(
      (r) => r.y > (layout.runs[0]?.y ?? 0),
    )
    expect(secondLineRuns.length).toBeGreaterThan(0)
    for (const run of secondLineRuns) expect(run.style.fill).not.toBe(AUTO_PURPLE)
  })

  it('override fill user tetap menang atas warna auto', () => {
    const l = base({ text: twoLine, fill: DEFAULT_TEXT_FILL })
    const s = styleAt(l, [{ start: 0, end: 5, fill: '#ff0000' }], 3)
    expect(s.fill).toBe('#ff0000')
  })

  it('hasMixedAutoPurple deteksi teks campuran', () => {
    expect(hasMixedAutoPurple(twoLine)).toBe(true)
    expect(hasMixedAutoPurple('* semua baris\n* juga ungu')).toBe(false)
    expect(hasMixedAutoPurple('tanpa asterisk\nbaris kedua')).toBe(false)
  })
})

describe('layoutRichText', () => {
  it('satu gaya → satu run per baris', () => {
    const l = base({ text: 'abc', width: 1000 })
    const layout = layoutRichText(l, [])
    expect(layout.runs).toHaveLength(1)
    expect(layout.runs[0]?.text).toBe('abc')
    expect(layout.height).toBeCloseTo(32 * 1.2, 1)
  })

  it('memecah run di batas gaya', () => {
    const l = base({ text: 'abcde' })
    const layout = layoutRichText(l, [{ start: 2, end: 4, fill: '#ff0000' }])
    expect(layout.runs.map((r) => r.text)).toEqual(['ab', 'cd', 'e'])
    expect(layout.runs[1]?.style.fill).toBe('#ff0000')
  })

  it('tanpa wrap: tetap satu baris walau width kecil', () => {
    // Fallback pengukuran jsdom: 0.6 * fontSize per karakter.
    const l = base({ text: 'aa bb cc', width: 20, fontSize: 10 })
    const layout = layoutRichText(l, [])
    const ys = new Set(layout.runs.map((r) => r.y))
    // Satu baris — teks memanjang mengikuti konten, tak dipatah oleh lebar box.
    expect(ys.size).toBe(1)
    // Hanya `\n` yang memecah baris.
    const withEnter = layoutRichText(base({ text: 'aa bb\ncc', fontSize: 10 }), [])
    expect(new Set(withEnter.runs.map((r) => r.y)).size).toBe(2)
  })

  it('baris baru \\n membentuk baris terpisah', () => {
    const l = base({ text: 'satu\ndua', width: 1000 })
    const layout = layoutRichText(l, [])
    expect(layout.runs).toHaveLength(2)
    expect(layout.runs[1]?.y).toBeGreaterThan(layout.runs[0]?.y ?? 0)
  })

  it('enter beruntun menghasilkan baris kosong (ruangnya ikut terhitung)', () => {
    const l = base({ text: 'a\n\nb', fontSize: 10, lineHeight: 1 })
    const layout = layoutRichText(l, [])
    // Dua run ('a', 'b') di y berbeda; baris kosong di antaranya tetap
    // menambah tinggi: 3 baris × 10px.
    expect(layout.runs).toHaveLength(2)
    expect(new Set(layout.runs.map((r) => r.y)).size).toBe(2)
    expect(layout.height).toBeCloseTo(30, 1)
    // Teks diawali & diakhiri enter: baris kosong awal/akhir ikut dihitung.
    const padded = layoutRichText(base({ text: '\na\n', fontSize: 10, lineHeight: 1 }), [])
    expect(padded.height).toBeCloseTo(30, 1)
    // Tiga enter beruntun = empat baris.
    const many = layoutRichText(base({ text: 'a\n\n\n\nb', fontSize: 10, lineHeight: 1 }), [])
    expect(many.height).toBeCloseTo(50, 1)
  })

  it('tinggi baris mengikuti ukuran font terbesar di baris itu', () => {
    const l = base({ text: 'ab', fontSize: 10, lineHeight: 1 })
    const layout = layoutRichText(l, [{ start: 1, end: 2, fontSize: 40 }])
    expect(layout.height).toBeCloseTo(40, 1)
  })
})

describe('dokumen dengan styleRanges', () => {
  it('parse menerima text layer ber-styleRanges', () => {
    const doc = createEmptyDocument()
    doc.layers.push(
      base({ styleRanges: [{ start: 0, end: 4, fill: '#ff0000', fontSize: 40 }] }),
    )
    const result = parseDocument(doc)
    expect(result.ok).toBe(true)
  })

  it('migrasi clamp ranges warisan ke panjang text', () => {
    const layer = newTextLayer({ text: 'halo' }) as unknown as Record<string, unknown>
    layer.styleRanges = [
      { start: 2, end: 99, fill: '#ff0000' },
      { start: 5, end: 5, fill: '#00ff00' },
    ]
    const out = migrateDocument({ schemaVersion: 1, layers: [layer] }) as {
      layers: Array<{ styleRanges?: TextStyleRange[] }>
    }
    expect(out.layers[0]?.styleRanges).toEqual([{ start: 2, end: 4, fill: '#ff0000' }])
  })
})
