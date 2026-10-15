import { describe, expect, it } from 'vitest'
import {
  applyChatlogToDocument,
  CHATLOG_LAYER_PREFIX,
  countMainImages,
  DEFAULT_CHATLOG_STYLE,
  parseChatlogLines,
  refitChatlogLayers,
  type ChatlogStyle,
} from '@/lib/chatlog'
import { createEmptyDocument } from '@/lib/editorDocument'
import { newImageLayer, newTextLayer } from '@/store/editor'
import type { EditorDocument, TextLayer } from '@/types/editor'

function addAsset(doc: EditorDocument, id: string): void {
  doc.assets[id] = {
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    width: 1280,
    height: 720,
    fileSize: 1000,
    checksum: id,
    objectKey: null,
    status: 'local',
    uploadProgress: 0,
    error: null,
  }
  doc.layers.push(newImageLayer({ assetId: id, width: 1280, height: 720, x: 0, y: 0 }))
}

function makeDoc(imageCount: number): EditorDocument {
  const doc = createEmptyDocument()
  for (let i = 0; i < imageCount; i += 1) addAsset(doc, `img${i}`)
  return doc
}

const style: ChatlogStyle = { ...DEFAULT_CHATLOG_STYLE }

/** Kumpulkan layer text hasil automasi chatlog (sudah di-narrow ke TextLayer). */
function chatlogLayersOf(doc: EditorDocument): TextLayer[] {
  return doc.layers.filter(
    (l): l is TextLayer => l.type === 'text' && l.name.startsWith(CHATLOG_LAYER_PREFIX),
  )
}

describe('parseChatlogLines', () => {
  it('memecah per baris, mem-trim, dan membuang baris kosong', () => {
    const lines = parseChatlogLines('  Halo dunia  \r\n\r\n\n* OOC blabla\n   ')
    expect(lines).toEqual(['Halo dunia', '* OOC blabla'])
  })

  it('mengembalikan [] untuk konten kosong', () => {
    expect(parseChatlogLines('')).toEqual([])
    expect(parseChatlogLines('\n \n')).toEqual([])
  })
})

describe('applyChatlogToDocument', () => {
  it('membuat 2 layer text per gambar (atas + bawah) dengan nama berprefix Chatlog', () => {
    const doc = makeDoc(2)
    const lines = Array.from({ length: 20 }, (_, i) => `baris ${i}`)

    const applied = applyChatlogToDocument(doc, lines, style)

    expect(applied).toBe(2)
    const chatlogLayers = chatlogLayersOf(doc)
    expect(chatlogLayers).toHaveLength(4)

    const atas = chatlogLayers.filter((l) => l.name === `${CHATLOG_LAYER_PREFIX} atas`)
    const bawah = chatlogLayers.filter((l) => l.name === `${CHATLOG_LAYER_PREFIX} bawah`)
    expect(atas).toHaveLength(2)
    expect(bawah).toHaveLength(2)

    // Blok atas gambar pertama = 5 baris pertama, blok bawah = 5 baris berikutnya.
    expect(atas[0]?.text).toBe(['baris 0', 'baris 1', 'baris 2', 'baris 3', 'baris 4'].join('\n'))
    expect(bawah[0]?.text).toBe(['baris 5', 'baris 6', 'baris 7', 'baris 8', 'baris 9'].join('\n'))
    // Gambar kedua melanjutkan urutan.
    expect(atas[1]?.text).toBe(['baris 10', 'baris 11', 'baris 12', 'baris 13', 'baris 14'].join('\n'))
    // assetId menunjuk ke gambar yang benar.
    expect(atas[0]?.assetId).toBe('img0')
    expect(atas[1]?.assetId).toBe('img1')
  })

  it('idempoten: apply ulang mengganti layer lama, bukan menumpuk', () => {
    const doc = makeDoc(2)
    const lines = Array.from({ length: 20 }, (_, i) => `baris ${i}`)

    applyChatlogToDocument(doc, lines, style)
    const firstCount = doc.layers.length
    applyChatlogToDocument(doc, lines, style)

    const chatlogLayers = chatlogLayersOf(doc)
    expect(chatlogLayers).toHaveLength(4)
    expect(doc.layers.length).toBe(firstCount)
  })

  it('mengabaikan baris sisa yang tidak muat di gambar', () => {
    const doc = makeDoc(1)
    const lines = Array.from({ length: 12 }, (_, i) => `baris ${i}`)

    const applied = applyChatlogToDocument(doc, lines, style)

    expect(applied).toBe(1)
    const chatlogLayers = chatlogLayersOf(doc)
    expect(chatlogLayers).toHaveLength(2)
    // Kapasitas 1 gambar = 10 kalimat → baris 10 & 11 (index 10, 11) diabaikan.
    expect(chatlogLayers[1]?.text).toContain('baris 9')
    expect(chatlogLayers[1]?.text).not.toContain('baris 10')
    expect(chatlogLayers.some((l) => l.text.includes('baris 11'))).toBe(false)
  })

  it('blok bawah dijepit pada margin atas gambar bila estimasi tinggi tidak muat', () => {
    const doc = makeDoc(1)
    const tall: ChatlogStyle = { ...style, fontSize: 200, bottomCount: 5 }
    const lines = Array.from({ length: 10 }, (_, i) => `baris ${i}`)

    applyChatlogToDocument(doc, lines, tall)

    const bawah = doc.layers.find(
      (l) => l.type === 'text' && l.name === `${CHATLOG_LAYER_PREFIX} bawah`,
    )
    if (!bawah) throw new Error('layer bawah tidak ditemukan')
    // tinggi estimasi 5 × 200 × 1.2 = 1200 > tinggi gambar 720 → dijepit ke margin.
    expect(bawah.y).toBe(tall.margin)
    expect(bawah.y).toBeGreaterThanOrEqual(tall.margin)
  })

  it('blok bawah menempel di tepi bawah gambar sesuai margin', () => {
    const doc = makeDoc(1)
    const lines = Array.from({ length: 10 }, (_, i) => `baris ${i}`)

    applyChatlogToDocument(doc, lines, style)

    const bawah = doc.layers.find(
      (l) => l.type === 'text' && l.name === `${CHATLOG_LAYER_PREFIX} bawah`,
    )
    if (!bawah) throw new Error('layer bawah tidak ditemukan')
    const estimatedHeight = 5 * style.fontSize * style.lineHeight
    expect(bawah.y).toBe(720 - style.margin - estimatedHeight)
  })

  it('menerapkan style font ke layer yang dibuat', () => {
    const doc = makeDoc(1)
    const custom: ChatlogStyle = {
      ...style,
      fontFamily: 'Verdana',
      fontSize: 30,
      fontWeight: 500,
      fontStyle: 'italic',
      fill: '#ff0000',
      stroke: '#00ff00',
      strokeWidth: 3,
      shadowBlur: 8,
      lineHeight: 1.5,
      align: 'center',
    }

    applyChatlogToDocument(doc, ['satu', 'dua'], custom)

    const layer = doc.layers.find((l) => l.type === 'text' && l.name.startsWith(CHATLOG_LAYER_PREFIX))
    if (!layer || layer.type !== 'text') throw new Error('layer chatlog tidak ditemukan')
    expect(layer.fontFamily).toBe('Verdana')
    expect(layer.fontSize).toBe(30)
    expect(layer.fontWeight).toBe(500)
    expect(layer.fontStyle).toBe('italic')
    expect(layer.fill).toBe('#ff0000')
    expect(layer.stroke).toBe('#00ff00')
    expect(layer.strokeWidth).toBe(3)
    expect(layer.shadowBlur).toBe(8)
    expect(layer.lineHeight).toBe(1.5)
    expect(layer.align).toBe('center')
  })

  it('tidak mengubah layer chatlog yang bukan milik automasi (prefix berbeda)', () => {
    const doc = makeDoc(1)
    const manual = newTextLayer({ name: 'Catatan manual', text: 'punya user' })
    doc.layers.push(manual)

    applyChatlogToDocument(doc, ['baris'], style)

    expect(doc.layers.some((l) => l.name === 'Catatan manual')).toBe(true)
  })

  it('mengembalikan 0 bila tidak ada gambar', () => {
    const doc = createEmptyDocument()
    expect(applyChatlogToDocument(doc, ['satu'], style)).toBe(0)
    expect(doc.layers.filter((l) => l.type === 'text')).toHaveLength(0)
  })
})

describe('countMainImages', () => {
  it('menghitung gambar utama tanpa overlay', () => {
    const doc = makeDoc(3)
    // Overlay: layer image yang menimpa aset lain (ownerAssetId terisi).
    const overlayAsset = newImageLayer({ assetId: 'ovl', width: 100, height: 100 })
    if (overlayAsset.type !== 'image') throw new Error('expected image layer')
    overlayAsset.ownerAssetId = 'img0'
    doc.assets['ovl'] = { ...doc.assets['img0']!, id: 'ovl', name: 'ovl.png', checksum: 'ovl' }
    doc.layers.push(overlayAsset)

    expect(countMainImages(doc)).toBe(3)
  })
})

describe('refitChatlogLayers', () => {
  function firstChatlog(doc: EditorDocument, suffix: 'atas' | 'bawah'): TextLayer {
    const layer = doc.layers.find(
      (l): l is TextLayer =>
        l.type === 'text' && l.name === `${CHATLOG_LAYER_PREFIX} ${suffix}`,
    )
    if (!layer) throw new Error(`layer chatlog ${suffix} tidak ditemukan`)
    return layer
  }

  it('blok bawah ikut menyesuaikan setelah tinggi gambar berubah (crop)', () => {
    const doc = makeDoc(1)
    const lines = Array.from({ length: 10 }, (_, i) => `baris ${i}`)
    applyChatlogToDocument(doc, lines, style)

    // Simulasikan hasil crop: tinggi image layer menyusut dari 720 → 400.
    const img = doc.layers.find((l) => l.type === 'image' && l.assetId === 'img0')
    if (!img) throw new Error('image layer tidak ditemukan')
    img.height = 400

    refitChatlogLayers(doc)

    const estimatedHeight = 5 * style.fontSize * style.lineHeight
    expect(firstChatlog(doc, 'bawah').y).toBe(400 - style.margin - estimatedHeight)
    expect(firstChatlog(doc, 'atas').y).toBe(style.margin)
  })

  it('menggunakan margin yang tersimpan di layer (chatlogMargin), bukan default', () => {
    const doc = makeDoc(1)
    const custom: ChatlogStyle = { ...style, margin: 30 }
    applyChatlogToDocument(doc, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], custom)

    const img = doc.layers.find((l) => l.type === 'image' && l.assetId === 'img0')
    if (!img) throw new Error('image layer tidak ditemukan')
    img.height = 400
    refitChatlogLayers(doc)

    expect(firstChatlog(doc, 'atas').y).toBe(30)
    expect(firstChatlog(doc, 'bawah').y).toBe(400 - 30 - 5 * style.fontSize * style.lineHeight)
  })

  it('posisi dihitung dari area gambar yang terlihat (irisan gambar ∩ canvas)', () => {
    const doc = makeDoc(1)
    const lines = Array.from({ length: 10 }, (_, i) => `baris ${i}`)
    applyChatlogToDocument(doc, lines, style)

    // Gambar menonjol ke luar canvas: y=500, height=720 → terlihat hanya 500..720.
    const img = doc.layers.find((l) => l.type === 'image' && l.assetId === 'img0')
    if (!img) throw new Error('image layer tidak ditemukan')
    img.y = 500
    refitChatlogLayers(doc)

    const estimatedHeight = 5 * style.fontSize * style.lineHeight
    expect(firstChatlog(doc, 'atas').y).toBe(500 + style.margin)
    // Blok bawah menempel tepi bawah canvas (720), bukan tepi gambar (1220).
    expect(firstChatlog(doc, 'bawah').y).toBe(720 - style.margin - estimatedHeight)
  })

  it('blok bawah tidak jatuh di luar canvas saat canvas mengecil', () => {
    const doc = makeDoc(1)
    const lines = Array.from({ length: 10 }, (_, i) => `baris ${i}`)
    applyChatlogToDocument(doc, lines, style)

    // Canvas dikecilkan (crop canvas) — gambar tetap 1280×720, hanya di-clip.
    doc.canvas.height = 300
    refitChatlogLayers(doc)

    const bawah = firstChatlog(doc, 'bawah')
    const estimatedHeight = 5 * style.fontSize * style.lineHeight
    expect(bawah.y).toBe(300 - style.margin - estimatedHeight)
    expect(bawah.y + estimatedHeight).toBeLessThanOrEqual(doc.canvas.height)
  })

  it('tidak menyentuh layer text non-chatlog dan layer tanpa gambar induk', () => {
    const doc = makeDoc(1)
    const manual = newTextLayer({ name: 'Catatan manual', text: 'punya user', x: 999, y: 999 })
    doc.layers.push(manual)

    refitChatlogLayers(doc)

    expect(manual.x).toBe(999)
    expect(manual.y).toBe(999)
  })
})
