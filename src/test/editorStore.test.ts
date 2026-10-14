import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyTextStyleToAllImages,
  AUTO_PURPLE,
  DEFAULT_TEXT_FILL,
  duplicateLayer,
  newImageLayer,
  newRectLayer,
  newTextLayer,
  useEditorStore,
} from '@/store/editor'
import { createEmptyDocument } from '@/lib/editorDocument'
import type { TextLayer } from '@/types/editor'

beforeEach(() => {
  useEditorStore.getState().loadDocument(createEmptyDocument(), null)
})

describe('auto purple for asterisk text', () => {
  it('colors text layers that start with * purple on mutate', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newTextLayer({ text: '*Aku berjalan pelan.' }))
    })
    const layer = useEditorStore.getState().document.layers[0]
    expect(layer?.type === 'text' && layer.fill).toBe(AUTO_PURPLE)
  })

  it('does not recolor text that does not start with *', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newTextLayer({ text: 'halo', fill: '#123456' }))
    })
    const layer = useEditorStore.getState().document.layers[0]
    expect(layer?.type === 'text' && layer.fill).toBe('#123456')
  })

  it('teks campuran (* + baris setelah enter) dasarnya tetap putih', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(
        newTextLayer({
          text: '* Darren is waving his hand\nDarren says: Jancok',
        }),
      )
    })
    const layer = useEditorStore.getState().document.layers[0]
    // Fill dasar putih; baris * tetap ungu via renderer per-baris.
    expect(layer?.type === 'text' && layer.fill).toBe(DEFAULT_TEXT_FILL)
  })

  it('teks campuran yang masih ungu (dokumen lama) di-reset ke putih', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(
        newTextLayer({
          text: '* aksi\n dialog',
          fill: AUTO_PURPLE,
        }),
      )
    })
    const layer = useEditorStore.getState().document.layers[0]
    expect(layer?.type === 'text' && layer.fill).toBe(DEFAULT_TEXT_FILL)
  })
})

describe('mutate / undo / redo', () => {
  it('marks the document dirty and records history', () => {
    const s = useEditorStore.getState()
    expect(s.dirty).toBe(false)
    s.mutate((doc) => {
      doc.layers.push(newTextLayer())
    })
    const after = useEditorStore.getState()
    expect(after.dirty).toBe(true)
    expect(after.document.layers).toHaveLength(1)
    expect(after.past).toHaveLength(1)
  })

  it('undo restores the previous document, redo reapplies', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newTextLayer({ text: 'hello' }))
    })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().document.layers).toHaveLength(0)
    useEditorStore.getState().redo()
    const layers = useEditorStore.getState().document.layers
    expect(layers).toHaveLength(1)
    expect(layers[0]?.type === 'text' && layers[0].text).toBe('hello')
  })

  it('clears the redo stack on a fresh mutation', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newRectLayer())
    })
    useEditorStore.getState().undo()
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newTextLayer())
    })
    expect(useEditorStore.getState().future).toHaveLength(0)
  })

  it('coalesces consecutive coalesce-flagged mutations into one entry', () => {
    const s = useEditorStore.getState()
    s.mutate((doc) => {
      doc.canvas.background = '#222222'
    })
    s.mutate(
      (doc) => {
        doc.canvas.background = '#333333'
      },
      { coalesce: true },
    )
    s.mutate(
      (doc) => {
        doc.canvas.background = '#444444'
      },
      { coalesce: true },
    )
    const after = useEditorStore.getState()
    expect(after.document.canvas.background).toBe('#444444')
    expect(after.past).toHaveLength(1)
    after.undo()
    expect(useEditorStore.getState().document.canvas.background).toBe('#111111')
  })

  it('caps history at 100 entries', () => {
    for (let i = 0; i < 120; i += 1) {
      useEditorStore.getState().mutate((doc) => {
        doc.canvas.background = `#${String(i).padStart(6, '0')}`
      })
    }
    expect(useEditorStore.getState().past.length).toBeLessThanOrEqual(100)
  })
})

describe('loadDocument', () => {
  it('resets history, selection, view and dirty state', () => {
    const s = useEditorStore.getState()
    s.mutate((doc) => {
      doc.layers.push(newTextLayer())
    })
    useEditorStore.getState().setSelection(['x'])
    useEditorStore.getState().setZoom(2)
    useEditorStore.getState().loadDocument(createEmptyDocument(), 7)

    const after = useEditorStore.getState()
    expect(after.revision).toBe(7)
    expect(after.dirty).toBe(false)
    expect(after.past).toHaveLength(0)
    expect(after.selection).toEqual([])
    expect(after.zoom).toBe(1)
  })
})

describe('duplicateLayer', () => {
  it('creates a copy with a new id and offset position', () => {
    const original = newRectLayer()
    const copy = duplicateLayer(original)
    expect(copy.id).not.toBe(original.id)
    expect(copy.x).toBe(original.x + 20)
    expect(copy.y).toBe(original.y + 20)
    expect(copy.name).toBe(`${original.name} copy`)
  })
})

describe('selection', () => {
  it('addToSelection ignores duplicates', () => {
    const s = useEditorStore.getState()
    s.setSelection(['a'])
    useEditorStore.getState().addToSelection('a')
    expect(useEditorStore.getState().selection).toEqual(['a'])
    useEditorStore.getState().addToSelection('b')
    expect(useEditorStore.getState().selection).toEqual(['a', 'b'])
  })
})

describe('applyTextStyleToAllImages', () => {
  const textAt = (index: number): TextLayer => {
    const layer = useEditorStore.getState().document.layers[index]
    if (!layer || layer.type !== 'text') throw new Error('expected text layer')
    return layer
  }

  it('ungu otomatis dari text * tidak menyebar ke text tanpa awalan *', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newTextLayer({ text: '*Berjalan pelan.', fontSize: 40 }))
      doc.layers.push(newTextLayer({ text: 'chat biasa' }))
      doc.layers.push(newTextLayer({ text: 'label warna lain', fill: '#ffcc00' }))
      doc.layers.push(newTextLayer({ text: '*aksi kedua' }))
    })
    const src = textAt(0)
    expect(src.fill).toBe(AUTO_PURPLE) // distempel funnel karena awalan *

    useEditorStore.getState().mutate((doc) => applyTextStyleToAllImages(doc, src))

    const layers = useEditorStore.getState().document.layers
    // Semua mendapat gaya sumber...
    for (const layer of layers) {
      expect(layer.type === 'text' && layer.fontSize).toBe(40)
    }
    // ...tapi warna mengikuti aturan * per-text masing-masing.
    expect(textAt(1).fill).toBe(DEFAULT_TEXT_FILL)
    expect(textAt(2).fill).toBe(DEFAULT_TEXT_FILL) // kembali ke dasar, bukan ungu
    expect(textAt(3).fill).toBe(AUTO_PURPLE)
  })

  it('ungu manual (bukan auto) tetap disalin apa adanya', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newTextLayer({ text: 'judul manual', fill: AUTO_PURPLE }))
      doc.layers.push(newTextLayer({ text: 'target' }))
    })
    const src = textAt(0)
    useEditorStore.getState().mutate((doc) => applyTextStyleToAllImages(doc, src))
    expect(textAt(1).fill).toBe(AUTO_PURPLE)
  })

  it('menghapus styleRanges target agar hasil benar-benar seragam', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newTextLayer({ text: 'polos' }))
      const target = newTextLayer({ text: 'ada range gaya' }) as TextLayer
      target.styleRanges = [{ start: 0, end: 3, fill: '#ff0000' }]
      doc.layers.push(target)
    })
    const src = textAt(0)
    useEditorStore.getState().mutate((doc) => applyTextStyleToAllImages(doc, src))
    expect(textAt(1).styleRanges).toBeUndefined()
  })
})

describe('per-image layer scope (claim unscoped layers)', () => {
  it('loadDocument assigns legacy unscoped text to the first image', () => {
    const doc = createEmptyDocument()
    doc.layers.push(newImageLayer({ assetId: 'a1', width: 800, height: 600 }))
    doc.layers.push(newTextLayer({ text: 'text lama' })) // assetId: null (legacy)
    useEditorStore.getState().loadDocument(doc, null)
    const text = useEditorStore.getState().document.layers.find((l) => l.type === 'text')
    expect(text?.type === 'text' && text.assetId).toBe('a1')
  })

  it('setActiveAsset claims layers created before any image existed', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newTextLayer()) // belum ada gambar → assetId null
    })
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newImageLayer({ assetId: 'a9', width: 800, height: 600 }))
    })
    useEditorStore.getState().setActiveAsset('a9')
    const text = useEditorStore.getState().document.layers.find((l) => l.type === 'text')
    expect(text?.type === 'text' && text.assetId).toBe('a9')
  })

  it('does not re-claim layers that already belong to another image', () => {
    useEditorStore.getState().mutate((doc) => {
      doc.layers.push(newImageLayer({ assetId: 'a1', width: 800, height: 600 }))
      doc.layers.push(newImageLayer({ assetId: 'a2', width: 800, height: 600 }))
      doc.layers.push(newTextLayer({ assetId: 'a1', text: 'milik a1' }))
    })
    useEditorStore.getState().setActiveAsset('a2')
    const text = useEditorStore.getState().document.layers.find((l) => l.type === 'text')
    expect(text?.type === 'text' && text.assetId).toBe('a1')
  })
})
