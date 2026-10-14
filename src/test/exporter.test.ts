import { describe, expect, it } from 'vitest'
import {
  buildSnippets,
  exportFileName,
  extensionFor,
} from '@/lib/exporter'

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
