import { describe, expect, it } from 'vitest'
import {
  assetExportCrop,
  buildSnippets,
  exportFileName,
  extensionFor,
} from '@/lib/exporter'
import { createEmptyDocument } from '@/lib/editorDocument'
import { newImageLayer } from '@/store/editor'
import type { AssetRef, EditorDocument, ImageLayer } from '@/types/editor'

function addAsset(doc: EditorDocument, id: string, width = 1920, height = 1080): ImageLayer {
  const asset: AssetRef = {
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    width,
    height,
    fileSize: 1000,
    checksum: id,
    objectKey: null,
    status: 'local',
    uploadProgress: 0,
    error: null,
  }
  doc.assets[id] = asset
  const layer = newImageLayer({ assetId: id, width, height, x: 0, y: 0 })
  if (layer.type !== 'image') throw new Error('expected image layer')
  doc.layers.push(layer)
  return layer
}

describe('extensionFor', () => {
  it('maps jpeg to jpg and keeps the others', () => {
    expect(extensionFor('jpeg')).toBe('jpg')
    expect(extensionFor('png')).toBe('png')
    expect(extensionFor('webp')).toBe('webp')
  })
})

describe('exportFileName', () => {
  it('omits the index for single-file exports', () => {
    expect(exportFileName('ssrp', null, 'png')).toBe('ssrp.png')
  })

  it('zero-pads the index to three digits', () => {
    expect(exportFileName('ssrp', 7, 'jpeg')).toBe('ssrp-007.jpg')
    expect(exportFileName('ssrp', 1234, 'webp')).toBe('ssrp-1234.webp')
  })

  it('sanitizes unsafe prefix characters', () => {
    expect(exportFileName('my shots (final)', null, 'png')).toBe('my-shots-final-.png')
  })

  it('falls back to "ssrp" only when nothing remains after sanitizing', () => {
    expect(exportFileName('   ', null, 'png')).toBe('ssrp.png')
    expect(exportFileName('   ', 1, 'png')).toBe('ssrp-001.png')
  })
})

describe('buildSnippets', () => {
  const published = [
    { name: 'ssrp-001.png', url: 'https://cdn.example.com/a.png' },
    { name: 'ssrp-002.png', url: 'https://cdn.example.com/b.png' },
  ]

  it('joins raw URLs with newlines', () => {
    expect(buildSnippets(published).urls).toBe(
      'https://cdn.example.com/a.png\nhttps://cdn.example.com/b.png',
    )
  })

  it('builds BBCode [img] tags', () => {
    expect(buildSnippets(published).bbcode).toBe(
      '[img]https://cdn.example.com/a.png[/img]\n[img]https://cdn.example.com/b.png[/img]',
    )
  })

  it('builds Markdown embeds with the file name (sans extension) as alt text', () => {
    expect(buildSnippets(published).markdown).toBe(
      '![ssrp-001](https://cdn.example.com/a.png)\n![ssrp-002](https://cdn.example.com/b.png)',
    )
  })

  it('builds HTML <img> tags', () => {
    expect(buildSnippets(published).html).toBe(
      '<img src="https://cdn.example.com/a.png" alt="ssrp-001">\n<img src="https://cdn.example.com/b.png" alt="ssrp-002">',
    )
  })

  it('handles an empty set', () => {
    const snippets = buildSnippets([])
    expect(snippets).toEqual({ urls: '', bbcode: '', markdown: '', html: '' })
  })
})

describe('assetExportCrop', () => {
  it('resolusi mengikuti canvas, bukan resolusi asli gambar', () => {
    const doc = createEmptyDocument() // canvas 1280×720
    const layer = addAsset(doc, 'img0', 1920, 1080)
    const asset = doc.assets['img0']!

    const crop = assetExportCrop(doc, layer, asset)

    expect(crop.outWidth).toBe(1280)
    expect(crop.outHeight).toBe(720)
    // Tanpa crop: region = gambar penuh.
    expect(crop.region).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('region & fit dari crop shared tetap dipakai, resolusi diganti canvas', () => {
    const doc = createEmptyDocument() // canvas 1280×720
    doc.sharedCrop = {
      region: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
      outWidth: 1920,
      outHeight: 1080,
      fit: 'fit',
      padColor: '#000000',
    }
    const layer = addAsset(doc, 'img0')
    const asset = doc.assets['img0']!

    const crop = assetExportCrop(doc, layer, asset)

    expect(crop.region).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })
    expect(crop.fit).toBe('fit')
    expect(crop.outWidth).toBe(1280)
    expect(crop.outHeight).toBe(720)
  })

  it('ikut menyesuaikan saat canvas diubah setelah crop', () => {
    const doc = createEmptyDocument()
    const layer = addAsset(doc, 'img0')
    layer.cropOverride = {
      region: { x: 0, y: 0, w: 1, h: 1 },
      outWidth: 1920,
      outHeight: 1080,
      fit: 'crop',
      padColor: '#000000',
    }
    doc.canvas.width = 1600
    doc.canvas.height = 900
    const asset = doc.assets['img0']!

    const crop = assetExportCrop(doc, layer, asset)

    expect(crop.outWidth).toBe(1600)
    expect(crop.outHeight).toBe(900)
  })
})
