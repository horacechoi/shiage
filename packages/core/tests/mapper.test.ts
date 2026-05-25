import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createV4ThemeSource } from '../src/tailwind/v4'
import { buildReverseLookup, type ReverseLookup } from '../src/tailwind/reverse-lookup'
import { findClassForProperty, classProducingProperty } from '../src/mapper'
import { parseColor, rgbToKey } from '../src/color'
import type { ThemeSource } from '../src/tailwind/types'

const cssEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/tailwind-v4/src/app.css',
)

describe('findClassForProperty (v4 theme)', () => {
  let source: ThemeSource
  let lookup: ReverseLookup
  beforeAll(async () => {
    source = await createV4ThemeSource(cssEntry)
    lookup = buildReverseLookup(source, { rootFontSizePx: 16 })
  })

  it('returns the canonical class for an exact scale match', () => {
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
  })

  it('absorbs sub-pixel noise from getComputedStyle', () => {
    expect(findClassForProperty('padding-left', '23.9994px', lookup)).toEqual({
      kind: 'canonical',
      className: 'pl-6',
    })
  })

  it('falls back to an arbitrary class when off-scale', () => {
    expect(findClassForProperty('padding-left', '23px', lookup)).toEqual({
      kind: 'arbitrary',
      className: 'pl-[23px]',
    })
    expect(findClassForProperty('opacity', '0.37', lookup)).toEqual({
      kind: 'arbitrary',
      className: 'opacity-[0.37]',
    })
  })

  it('matches theme colors exactly (oklch default + custom hex)', () => {
    const red = rgbToKey(parseColor('oklch(0.637 0.237 25.331)')!)
    expect(findClassForProperty('color', red, lookup)).toEqual({
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

  it('snaps a near-miss color to the closest theme color', () => {
    // One unit off the brand color → snapped, not arbitrary.
    const result = findClassForProperty('color', 'rgb(254, 85, 0)', lookup)
    expect(result.kind).toBe('snapped')
    if (result.kind === 'snapped') expect(result.className).toBe('text-brand')
  })

  it('emits an arbitrary hex color when there is no exact match and snapping is off', () => {
    // (rgb(1,2,3) is within the snap threshold of text-black, so disable snapping here.)
    expect(findClassForProperty('color', 'rgb(1, 2, 3)', lookup, { colorSnap: false })).toEqual({
      kind: 'arbitrary',
      className: 'text-[#010203]',
    })
  })

  it('reports unsupported properties and unmappable keywords', () => {
    expect(findClassForProperty('display', 'flex', lookup).kind).toBe('unsupported')
    expect(findClassForProperty('text-align', 'weird', lookup).kind).toBe('unsupported')
  })
})

describe('classProducingProperty (v4 theme)', () => {
  let source: ThemeSource
  beforeAll(async () => {
    source = await createV4ThemeSource(cssEntry)
  })

  it('finds the shorthand that covers a side', () => {
    expect(classProducingProperty(['p-4', 'text-red-500'], 'padding-left', source)).toEqual(['p-4'])
  })

  it('distinguishes axis from off-axis sides', () => {
    expect(classProducingProperty(['px-4', 'pt-2'], 'padding-left', source)).toEqual(['px-4'])
  })

  it('returns every token that sets the property', () => {
    expect(classProducingProperty(['pl-4', 'pl-6'], 'padding-left', source)).toEqual([
      'pl-4',
      'pl-6',
    ])
  })
})
