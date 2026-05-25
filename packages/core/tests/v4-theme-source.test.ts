import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createV4ThemeSource } from '../src/tailwind/v4'
import type { ThemeSource } from '../src/tailwind/types'

const cssEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/tailwind-v4/src/app.css',
)

describe('createV4ThemeSource (against the real Tailwind v4 engine)', () => {
  let src: ThemeSource
  beforeAll(async () => {
    src = await createV4ThemeSource(cssEntry)
  })

  it('reports version 4 and the source path', () => {
    expect(src.version).toBe(4)
    expect(src.sourcePath).toBe(cssEntry)
  })

  it('resolves p-4 to padding on all four sides at 16px', () => {
    expect(src.classToDecls(['p-4'])[0]).toEqual([
      { property: 'padding-top', value: '16px' },
      { property: 'padding-right', value: '16px' },
      { property: 'padding-bottom', value: '16px' },
      { property: 'padding-left', value: '16px' },
    ])
  })

  it('resolves the directional pl-6 to a single physical longhand', () => {
    expect(src.classToDecls(['pl-6'])[0]).toEqual([{ property: 'padding-left', value: '24px' }])
  })

  it('expands logical px-6 to physical left + right', () => {
    expect(src.classToDecls(['px-6'])[0]).toEqual([
      { property: 'padding-left', value: '24px' },
      { property: 'padding-right', value: '24px' },
    ])
  })

  it('leaves theme colors as oklch for downstream rgb conversion', () => {
    const [decls] = src.classToDecls(['text-red-500'])
    expect(decls).toHaveLength(1)
    expect(decls![0]!.property).toBe('color')
    expect(decls![0]!.value.startsWith('oklch(')).toBe(true)
  })

  it('reads the custom theme extension (text-brand → #ff5500)', () => {
    expect(src.classToDecls(['text-brand'])[0]).toEqual([{ property: 'color', value: '#ff5500' }])
  })

  it('resolves font-weight via its token and skips --tw-* plumbing', () => {
    expect(src.classToDecls(['font-bold'])[0]).toEqual([{ property: 'font-weight', value: '700' }])
  })

  it('keeps border-2 widths but drops the --tw-border-style var', () => {
    expect(src.classToDecls(['border-2'])[0]).toEqual([
      { property: 'border-top-width', value: '2px' },
      { property: 'border-right-width', value: '2px' },
      { property: 'border-bottom-width', value: '2px' },
      { property: 'border-left-width', value: '2px' },
    ])
  })

  it('handles keyword utilities', () => {
    expect(src.classToDecls(['text-center'])[0]).toEqual([
      { property: 'text-align', value: 'center' },
    ])
    expect(src.classToDecls(['border-dashed'])[0]).toEqual([
      { property: 'border-style', value: 'dashed' },
    ])
  })

  it('returns [] for invalid classes', () => {
    expect(src.classToDecls(['not-a-real-class'])[0]).toEqual([])
  })

  it('enumerates candidates within the requested namespaces only', () => {
    const names = src.enumerateCandidates(['spacing'])
    expect(names).toContain('p-4')
    expect(names).toContain('px-6')
    expect(names).toContain('pl-6')
    expect(names.length).toBeGreaterThan(20)
    expect(names).not.toContain('text-red-500')
  })

  it('resolves theme tokens and canonicalizes arbitrary spacing', () => {
    expect(src.resolveToken('--spacing')).toBe('0.25rem')
    expect(src.canonicalize(['p-[16px]'], 16)).toEqual(['p-4'])
  })
})
