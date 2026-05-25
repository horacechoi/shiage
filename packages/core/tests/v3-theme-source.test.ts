import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createV3ThemeSource } from '../src/tailwind/v3'
import { buildReverseLookup, type ReverseLookup } from '../src/tailwind/reverse-lookup'
import { findClassForProperty, mapChangesToClassEdits, type PropertyChange } from '../src/mapper'
import type { ThemeSource } from '../src/tailwind/types'

const configPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/tailwind-v3/tailwind.config.js',
)
const change = (property: string, newValue: string): PropertyChange => ({
  property,
  oldValue: '',
  newValue,
})

describe('createV3ThemeSource (jiti + resolveConfig)', () => {
  let source: ThemeSource
  let lookup: ReverseLookup
  beforeAll(async () => {
    source = await createV3ThemeSource(configPath)
    lookup = buildReverseLookup(source, { rootFontSizePx: 16 })
  })

  it('reports version 3 and the config path', () => {
    expect(source.version).toBe(3)
    expect(source.sourcePath).toBe(configPath)
  })

  it('resolves single classes to physical decls (px) like v4', () => {
    expect(source.classToDecls(['pl-6'])[0]).toEqual([{ property: 'padding-left', value: '24px' }])
    expect(source.classToDecls(['px-4'])[0]).toEqual([
      { property: 'padding-left', value: '16px' },
      { property: 'padding-right', value: '16px' },
    ])
    expect(source.classToDecls(['unknown-class'])[0]).toEqual([])
  })

  it('expands shorthands for footprint detection', () => {
    expect(source.classToDecls(['p-4'])[0]).toHaveLength(4)
  })

  // The headline of "both v3 and v4": identical mapping results from a different engine.
  it('produces the same canonical classes as v4 for shared scale values', () => {
    expect(findClassForProperty('padding-left', '24px', lookup)).toEqual({
      kind: 'canonical',
      className: 'pl-6',
    })
    expect(findClassForProperty('width', '256px', lookup)).toEqual({
      kind: 'canonical',
      className: 'w-64',
    })
    expect(findClassForProperty('font-weight', '700', lookup)).toEqual({
      kind: 'canonical',
      className: 'font-bold',
    })
    expect(findClassForProperty('opacity', '0.5', lookup)).toEqual({
      kind: 'canonical',
      className: 'opacity-50',
    })
    expect(findClassForProperty('text-align', 'center', lookup)).toEqual({
      kind: 'canonical',
      className: 'text-center',
    })
    expect(findClassForProperty('font-size', '16px', lookup)).toEqual({
      kind: 'canonical',
      className: 'text-base',
    })
  })

  it('matches v3 hex colors (red-500 = #ef4444) and the custom brand color', () => {
    expect(findClassForProperty('color', 'rgb(239, 68, 68)', lookup)).toEqual({
      kind: 'canonical',
      className: 'text-red-500',
    })
    expect(findClassForProperty('color', 'rgb(255, 85, 0)', lookup)).toEqual({
      kind: 'canonical',
      className: 'text-brand',
    })
    expect(findClassForProperty('background-color', 'rgb(255, 85, 0)', lookup)).toEqual({
      kind: 'canonical',
      className: 'bg-brand',
    })
  })

  it('runs the directional recombination against the v3 theme', () => {
    const all = map4('24px')
    const r = mapChangesToClassEdits(all, 'p-4', lookup, source)
    expect(r.add).toEqual(['p-6'])
    expect(r.remove).toEqual(['p-4'])

    const single = mapChangesToClassEdits([change('padding-left', '24px')], 'pl-4', lookup, source)
    expect(single.add).toEqual(['pl-6'])
    expect(single.remove).toEqual(['pl-4'])
  })

  it('handles negative margins', () => {
    expect(findClassForProperty('margin-left', '-24px', lookup)).toEqual({
      kind: 'canonical',
      className: '-ml-6',
    })
  })
})

function map4(value: string): PropertyChange[] {
  return ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].map((p) =>
    change(p, value),
  )
}
