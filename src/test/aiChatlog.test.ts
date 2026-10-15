import { describe, expect, it, vi } from 'vitest'
import {
  assembleResult,
  chunkLines,
  defaultSettings,
  detectActors,
  detectSystemLine,
  deterministicPass,
  isTimestampOnlyLine,
  parseDecisions,
  reasonFromCategory,
  runPipeline,
  splitChatlogLines,
  stripLeadingTimestamp,
  type ChatlogLine,
  type Decision,
  type LineChunk,
  type ProcessSettings,
} from '@/lib/aiChatlog'

describe('stripLeadingTimestamp', () => {
  it('menghapus format [YYYY-MM-DD HH:MM:SS]', () => {
    expect(stripLeadingTimestamp('[2026-10-15 20:10:01] Budi: halo')).toEqual({
      text: 'Budi: halo',
      removed: true,
    })
  })

  it('menghapus format [HH:MM:SS]', () => {
    expect(stripLeadingTimestamp('[20:10:01] halo semua')).toEqual({
      text: 'halo semua',
      removed: true,
    })
  })

  it('menghapus format tanpa kurung', () => {
    expect(stripLeadingTimestamp('2026-10-15 20:10 Budi: halo')).toEqual({
      text: 'Budi: halo',
      removed: true,
    })
    expect(stripLeadingTimestamp('20:10:01 pesan').removed).toBe(true)
  })

  it('tidak menyentuh angka di dalam dialog', () => {
    expect(stripLeadingTimestamp('Budi: balapan jam 20:10 ya')).toEqual({
      text: 'Budi: balapan jam 20:10 ya',
      removed: false,
    })
  })

  it('menghapus maksimal beberapa prefix berurutan', () => {
    const result = stripLeadingTimestamp('[2026-10-15 20:10:01] [20:10:02] halo')
    expect(result.removed).toBe(true)
    expect(result.text).toBe('halo')
  })
})

describe('isTimestampOnlyLine', () => {
  it('baris yang isinya hanya timestamp', () => {
    expect(isTimestampOnlyLine('[2026-10-15 20:10:01]')).toBe(true)
    expect(isTimestampOnlyLine('[20:10:01]')).toBe(true)
  })

  it('bukan baris timestamp-only', () => {
    expect(isTimestampOnlyLine('Budi: halo')).toBe(false)
    expect(isTimestampOnlyLine('')).toBe(false)
  })
})

describe('detectSystemLine', () => {
  it('mendeteksi broadcast server', () => {
    expect(detectSystemLine('Server: Maintenance dalam 10 menit')?.reason).toBe('system_message')
    expect(detectSystemLine('System: Gunakan /help')?.reason).toBe('system_message')
  })

  it('mendeteksi OOC struktural', () => {
    expect(detectSystemLine('(OOC) Budi: bentar ya')?.reason).toBe('ooc')
    expect(detectSystemLine('/ooc afk dulu')?.reason).toBe('ooc')
    expect(detectSystemLine('(( tunggu sebentar ))')?.reason).toBe('ooc')
  })

  it('mendeteksi notifikasi server', () => {
    expect(detectSystemLine('Budi_Hendrawan has just joined the server.')?.reason).toBe(
      'server_notification',
    )
    expect(detectSystemLine('Cahya lost connection.')?.reason).toBe('server_notification')
  })

  it('tidak menghapus dialog RP yang mengandung kata sistem', () => {
    expect(detectSystemLine('Budi says: "join aku ya"')).toBeNull()
    expect(detectSystemLine('Rina tells Budi: server nanti kita sidak')).toBeNull()
  })
})

describe('detectActors', () => {
  it('mendeteksi pola "Nama: pesan" dan "Nama says"', () => {
    const lines = splitChatlogLines(
      [
        'Budi: halo',
        'Budi: gimana kabarmu',
        'Sari says: "mau ikut?"',
        'Budi tells Sari: nanti',
        'the quick brown fox',
      ].join('\n'),
    )
    const actors = detectActors(lines)
    const names = actors.map((a) => a.name)
    expect(names).toContain('Budi')
    expect(names).toContain('Sari')
    expect(names).not.toContain('the')
    expect(actors.find((a) => a.name === 'Budi')?.count).toBe(3)
  })
})

describe('chunkLines', () => {
  it('membagi baris sesuai batas karakter dengan konteks overlap', () => {
    const lines: ChatlogLine[] = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      text: `Baris ke-${i} dengan isi cukup panjang untuk memaksa pembagian chunk.`,
    }))
    const chunks = chunkLines(lines, 200, 2)
    expect(chunks.length).toBeGreaterThan(1)
    // Semua baris menjadi target tepat satu kali.
    const targetIds = chunks.flatMap((c) => c.target.map((l) => l.id))
    expect(targetIds).toEqual(lines.map((l) => l.id))
    // Chunk pertama tanpa konteks sebelum, chunk terakhir tanpa konteks sesudah.
    expect(chunks[0]?.before).toEqual([])
    expect(chunks[chunks.length - 1]?.after).toEqual([])
    // Konteks overlap diambil dari chunk tetangga.
    expect(chunks[1]?.before.length).toBe(2)
    expect(chunks[1]?.before.map((l) => l.id)).toEqual(chunks[0]?.target.slice(-2).map((l) => l.id))
  })

  it('chunk tunggal untuk input pendek', () => {
    const chunks = chunkLines([{ id: 0, text: 'halo' }])
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.before).toEqual([])
    expect(chunks[0]?.after).toEqual([])
  })
})

describe('parseDecisions', () => {
  const valid = new Set([0, 1, 2])

  it('parse JSON valid', () => {
    const result = parseDecisions(
      '{"decisions":[{"id":0,"keep":true},{"id":1,"keep":false,"category":"ooc","reason":"OOC"}]}',
      valid,
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 0, keep: true })
    expect(result[1]).toMatchObject({ id: 1, keep: false, category: 'ooc' })
  })

  it('membungkus bal ```json`, membuang id invalid & duplikat', () => {
    const content = [
      '```json',
      '{"decisions":[{"id":0,"keep":false},{"id":99,"keep":false},{"id":0,"keep":true},{"id":"x","keep":true},{"id":2,"keep":true}]}',
      '```',
    ].join('\n')
    const result = parseDecisions(content, valid)
    expect(result.map((d) => d.id)).toEqual([0, 2])
    expect(result[0]?.keep).toBe(false)
  })

  it('melempar error pada bukan JSON', () => {
    expect(() => parseDecisions('maaf, terjadi kesalahan', valid)).toThrow()
  })

  it('melempar error tanpa daftar keputusan valid', () => {
    expect(() => parseDecisions('{"decisions":[]}', valid)).toThrow()
    expect(() => parseDecisions('{"foo":1}', valid)).toThrow()
  })
})

describe('reasonFromCategory', () => {
  it('memetakan kategori ke alasan', () => {
    expect(reasonFromCategory('ooc')).toBe('ooc')
    expect(reasonFromCategory('advertisement')).toBe('advertisement')
    expect(reasonFromCategory('kept')).toBe('irrelevant')
    expect(reasonFromCategory(undefined)).toBe('irrelevant')
    expect(reasonFromCategory('unknown')).toBe('irrelevant')
  })
})

describe('deterministicPass', () => {
  it('membuang baris kosong, timestamp-only, dan sistem sesuai filter', () => {
    const settings = defaultSettings()
    const lines = splitChatlogLines(
      [
        '[2026-10-15 20:10:01]',
        '',
        'Budi: halo',
        'Server: Maintenance',
        '(OOC) Sari: afk',
      ].join('\n'),
    )
    const pass = deterministicPass(lines, settings)
    expect(pass.removed.get(0)).toBe('timestamp')
    expect(pass.removed.get(1)).toBe('empty')
    expect(pass.removed.get(3)).toBe('system_message')
    expect(pass.removed.get(4)).toBe('ooc')
    expect(pass.remaining.map((l) => l.id)).toEqual([2])
  })

  it('mempertahankan timestamp bila keepTimestamps aktif', () => {
    const settings: ProcessSettings = { ...defaultSettings(), keepTimestamps: true }
    const lines = splitChatlogLines('[2026-10-15 20:10:01]')
    const pass = deterministicPass(lines, settings)
    expect(pass.removed.size).toBe(0)
    expect(pass.remaining).toHaveLength(1)
  })

  it('mempertahankan sistem bila filter dimatikan', () => {
    const settings = defaultSettings()
    settings.filters.serverNotifications = false
    const lines = splitChatlogLines('Budi has just joined the server.')
    const pass = deterministicPass(lines, settings)
    expect(pass.removed.size).toBe(0)
  })
})

describe('assembleResult', () => {
  const settings = defaultSettings()

  it('baris tanpa keputusan DIPERTAHANKAN', () => {
    const lines = splitChatlogLines('Budi: halo\nSari: pagi')
    const result = assembleResult(lines, new Map(), new Map(), settings, 0, [])
    expect(result.stats.retainedLines).toBe(2)
    expect(result.stats.status).toBe('complete')
    expect(result.output).toBe('Budi: halo\nSari: pagi')
  })

  it('menghapus timestamp di awal baris tersisa secara default', () => {
    const lines = splitChatlogLines('[2026-10-15 20:10:01] Budi: halo')
    const result = assembleResult(lines, new Map(), new Map(), settings, 0, [])
    expect(result.output).toBe('Budi: halo')
  })

  it('menggabungkan keputusan AI dan deterministik dengan alasan', () => {
    const lines = splitChatlogLines('[2026-10-15 20:10:01]\nBudi: halo\n(OOC) Sari: bentar')
    const det = new Map<number, ReturnType<typeof reasonFromCategory>>([
      [0, 'timestamp'],
      [2, 'ooc'],
    ])
    const decisions = new Map<number, Decision>([
      [1, { id: 1, keep: false, category: 'advertisement', reason: 'iklan toko' }],
    ])
    const result = assembleResult(lines, det, decisions, settings, 0, [])
    expect(result.stats.retainedLines).toBe(0)
    expect(result.removed).toHaveLength(3)
    expect(result.removed[1]).toMatchObject({
      id: 1,
      reason: 'advertisement',
      note: 'iklan toko',
    })
  })
})

describe('runPipeline', () => {
  it('menjalankan pipeline penuh dengan classifier mock', async () => {
    const input = [
      '[2026-10-15 20:10:01]',
      'Budi: ayo balapan malam ini',
      '(OOC) Sari: bentar',
      'Rina says: "ikut ya"',
      '',
      'Cahya: siap di depan garasi',
    ].join('\n')

    const classify = vi.fn(async (chunk: LineChunk): Promise<Decision[]> =>
      chunk.target.map((l) => ({
        id: l.id,
        keep: !l.text.includes('Cahya'),
        category: l.text.includes('Cahya') ? 'unrelated_scene' : 'kept',
        reason: 'di luar topik',
      })),
    )
    const progress: [number, number][] = []
    const result = await runPipeline(input, defaultSettings(), classify, (done, total) =>
      progress.push([done, total]),
    )

    expect(classify).toHaveBeenCalledTimes(1)
    expect(progress.at(-1)?.[0]).toBe(progress.at(-1)?.[1])
    // Baris kosong + timestamp + OOC dibuang deterministik.
    expect(result.removed.some((r) => r.reason === 'timestamp')).toBe(true)
    expect(result.removed.some((r) => r.reason === 'empty')).toBe(true)
    expect(result.removed.some((r) => r.reason === 'ooc')).toBe(true)
    // Cahya dibuang oleh AI, Budi & Rina bertahan tanpa timestamp.
    expect(result.output).toBe('Budi: ayo balapan malam ini\nRina says: "ikut ya"')
    expect(result.stats.originalLines).toBe(6)
    expect(result.stats.retainedLines).toBe(2)
    expect(result.stats.status).toBe('complete')
    expect(result.warnings).toEqual([])
  })

  it('chunk gagal memicu warning dan barisnya dipertahankan', async () => {
    const input = 'Budi: halo\nSari: pagi'
    const classify = vi.fn(async (): Promise<Decision[]> => {
      throw new Error('endpoint down')
    })
    const result = await runPipeline(input, defaultSettings(), classify)
    expect(result.output).toBe('Budi: halo\nSari: pagi')
    expect(result.stats.status).toBe('partial')
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('gagal')
  })

  it('berhenti lebih awal setelah 3 kegagalan berturut-turut', async () => {
    // 4000+ karakter per baris agar terpecah jadi beberapa chunk.
    const lines = Array.from(
      { length: 6 },
      (_, i) => `Budi: ${'panjang '.repeat(500)} ${i}`,
    )
    const classify = vi.fn(async (): Promise<Decision[]> => {
      throw new Error('down')
    })
    const result = await runPipeline(lines.join('\n'), defaultSettings(), classify)
    expect(classify.mock.calls.length).toBe(3)
    expect(result.stats.status).toBe('partial')
    expect(result.warnings.some((w) => w.includes('Berhenti lebih awal'))).toBe(true)
    // Semua baris tetap ada karena tidak ada keputusan penghapusan.
    expect(result.stats.retainedLines).toBe(6)
  })
})
