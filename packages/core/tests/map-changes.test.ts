import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createV4ThemeSource } from '../src/tailwind/v4'
import { buildReverseLookup, type ReverseLookup } from '../src/tailwind/reverse-lookup'
import { mapChangesToClassEdits, type PropertyChange } from '../src/mapper'
import { parseColor, rgbToKey } from '../src/color'
import type { ThemeSource } from '../src/tailwind/types'

const cssEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/tailwind-v4/src/app.css',
)
const change = (property: string, newValue: string, oldValue = ''): PropertyChange => ({
  property,
  oldValue,
  newValue,
})

describe('mapChangesToClassEdits (v4 theme)', () => {
  let source: ThemeSource
  let lookup: ReverseLookup
  beforeAll(async () => {
    source = await createV4ThemeSource(cssEntry)
    lookup = buildReverseLookup(source, { rootFontSizePx: 16 })
  })

  const map = (
    changes: PropertyChange[],
    className: string,
  ): ReturnType<typeof mapChangesToClassEdits> =>
    mapChangesToClassEdits(changes, className, lookup, source)

  it('adds a directional class for a single-side change on a fresh element', () => {
    const r = map([change('padding-left', '24px')], '')
    expect(r.add).toEqual(['pl-6'])
    expect(r.remove).toEqual([])
  })

  it('keeps an existing shorthand and lets the cascade override one side', () => {
    // p-4 stays; pl-6 wins for the left side (Tailwind orders directional after shorthand).
    const r = map([change('padding-left', '24px')], 'p-4 text-red-500')
    expect(r.add).toEqual(['pl-6'])
    expect(r.remove).toEqual([])
  })

  it('replaces a same-footprint directional class', () => {
    const r = map([change('padding-left', '24px')], 'pl-4')
    expect(r.add).toEqual(['pl-6'])
    expect(r.remove).toEqual(['pl-4'])
  })

  it('collapses all four equal sides to a shorthand and removes the old one', () => {
    const r = map(
      [
        change('padding-top', '24px'),
        change('padding-right', '24px'),
        change('padding-bottom', '24px'),
        change('padding-left', '24px'),
      ],
      'p-4',
    )
    expect(r.add).toEqual(['p-6'])
    expect(r.remove).toEqual(['p-4'])
  })

  it('collapses a matching axis pair', () => {
    const r = map([change('padding-left', '24px'), change('padding-right', '24px')], '')
    expect(r.add).toEqual(['px-6'])
  })

  it('keeps an axis class and overrides one side via cascade', () => {
    const r = map([change('padding-left', '24px')], 'px-4')
    expect(r.add).toEqual(['pl-6'])
    expect(r.remove).toEqual([])
  })

  it('emits individual classes when sides change to different values', () => {
    const r = map([change('padding-left', '24px'), change('padding-right', '8px')], '')
    expect(r.add.sort()).toEqual(['pl-6', 'pr-2'])
  })

  it('maps singleton sizing and removes the superseded class', () => {
    const r = map([change('width', '256px')], 'w-32')
    expect(r.add).toEqual(['w-64'])
    expect(r.remove).toEqual(['w-32'])
  })

  it('maps a color change and removes the old color class', () => {
    const red = rgbToKey(parseColor('oklch(0.637 0.237 25.331)')!)
    const r = map([change('color', red)], 'text-blue-500 font-bold')
    expect(r.add).toEqual(['text-red-500'])
    expect(r.remove).toEqual(['text-blue-500'])
  })

  it('recombines a negative margin on all sides', () => {
    const r = map(
      [
        change('margin-top', '-24px'),
        change('margin-right', '-24px'),
        change('margin-bottom', '-24px'),
        change('margin-left', '-24px'),
      ],
      '',
    )
    expect(r.add).toEqual(['-m-6'])
  })

  it('falls back to an arbitrary class off-scale', () => {
    const r = map([change('padding-left', '23px')], '')
    expect(r.add).toEqual(['pl-[23px]'])
  })

  it('reports unsupported properties without dropping the supported ones', () => {
    const r = map([change('display', 'flex'), change('width', '256px')], '')
    expect(r.unsupported).toContain('display')
    expect(r.add).toEqual(['w-64'])
  })
})
