import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createV4ThemeSource } from '../src/tailwind/v4'
import { buildReverseLookup, type ReverseLookup } from '../src/tailwind/reverse-lookup'
import { parseColor, rgbToKey } from '../src/color'

const cssEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/tailwind-v4/src/app.css',
)

describe('buildReverseLookup (v4 engine → inverted tables)', () => {
  let lookup: ReverseLookup
  beforeAll(async () => {
    lookup = buildReverseLookup(await createV4ThemeSource(cssEntry), { rootFontSizePx: 16 })
  })

  it('maps single-side spacing to directional classes', () => {
    expect(lookup.byProperty.get('padding-left')?.get('24px')).toBe('pl-6')
    expect(lookup.byProperty.get('padding-top')?.get('16px')).toBe('pt-4')
    expect(lookup.byProperty.get('margin-left')?.get('24px')).toBe('ml-6')
    expect(lookup.byProperty.get('column-gap')?.get('8px')).toBe('gap-x-2')
    expect(lookup.byProperty.get('row-gap')?.get('8px')).toBe('gap-y-2')
  })

  it('stores directional, never shorthand, classes (pl-4 not p-4)', () => {
    expect(lookup.byProperty.get('padding-left')?.get('16px')).toBe('pl-4')
  })

  it('maps sizing, font-weight, opacity, and keyword properties', () => {
    expect(lookup.byProperty.get('width')?.get('256px')).toBe('w-64')
    expect(lookup.byProperty.get('font-weight')?.get('700')).toBe('font-bold')
    expect(lookup.byProperty.get('opacity')?.get('0.5')).toBe('opacity-50')
    expect(lookup.byProperty.get('text-align')?.get('center')).toBe('text-center')
    expect(lookup.byProperty.get('border-style')?.get('dashed')).toBe('border-dashed')
  })

  it('maps font-size despite its companion line-height', () => {
    expect(lookup.byProperty.get('font-size')?.get('16px')).toBe('text-base')
  })

  it('maps single-side border width and radius (rounded/border-* prefixes)', () => {
    const borderTop = lookup.byProperty.get('border-top-width')?.get('2px')
    expect(borderTop).toBeDefined()
    expect(borderTop!.startsWith('border-t')).toBe(true)
    const radiusTl = lookup.byProperty.get('border-top-left-radius')?.get('8px')
    expect(radiusTl).toBeDefined()
    expect(radiusTl!.startsWith('rounded-')).toBe(true)
  })

  it('builds rgb-keyed color tables for the oklch theme and a custom hex color', () => {
    const colors = lookup.byColorProperty.get('color')
    expect(colors).toBeDefined()
    expect(colors!.exact.get('rgb(255, 85, 0)')).toBe('text-brand')
    const red = parseColor('oklch(0.637 0.237 25.331)')!
    expect(colors!.exact.get(rgbToKey(red))).toBe('text-red-500')
    expect(lookup.byColorProperty.get('background-color')?.exact.get('rgb(255, 85, 0)')).toBe(
      'bg-brand',
    )
    expect(lookup.byColorProperty.get('border-color')?.exact.get('rgb(255, 85, 0)')).toBe(
      'border-brand',
    )
  })
})
