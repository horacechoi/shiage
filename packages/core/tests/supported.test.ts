import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_PROPERTIES,
  SUPPORTED_PROPERTY_LIST,
  SUPPORTED_NAMESPACES,
  isSupportedProperty,
} from '../src/supported'

describe('SUPPORTED_PROPERTIES', () => {
  it('lists exactly the v1 property set from the build plan (§7)', () => {
    // 5 padding + 5 margin + 3 gap + 6 sizing + 6 typography + 1 background
    // + 5 border-width + 1 border-color + 5 border-radius + 1 border-style + 2 effects
    expect(SUPPORTED_PROPERTY_LIST).toHaveLength(40)
  })

  it('keeps SUPPORTED_PROPERTY_LIST in sync with the table', () => {
    expect(SUPPORTED_PROPERTY_LIST).toEqual(Object.keys(SUPPORTED_PROPERTIES))
  })

  it('recognizes supported properties and rejects out-of-scope ones', () => {
    expect(isSupportedProperty('padding-left')).toBe(true)
    expect(isSupportedProperty('background-color')).toBe(true)
    expect(isSupportedProperty('box-shadow')).toBe(true)
    // Intentionally unsupported in v1 (build plan §7).
    expect(isSupportedProperty('display')).toBe(false)
    expect(isSupportedProperty('transform')).toBe(false)
    expect(isSupportedProperty('position')).toBe(false)
    expect(isSupportedProperty('z-index')).toBe(false)
  })

  it('tags the four-side / two-axis properties with their physical group', () => {
    expect(SUPPORTED_PROPERTIES['padding-left'].group).toBe('padding')
    expect(SUPPORTED_PROPERTIES['margin-top'].group).toBe('margin')
    expect(SUPPORTED_PROPERTIES['column-gap'].group).toBe('gap')
    expect(SUPPORTED_PROPERTIES['border-top-width'].group).toBe('borderWidth')
    expect(SUPPORTED_PROPERTIES['border-top-left-radius'].group).toBe('borderRadius')
  })

  it('leaves singleton properties ungrouped', () => {
    expect(SUPPORTED_PROPERTIES['width'].group).toBeUndefined()
    expect(SUPPORTED_PROPERTIES['font-size'].group).toBeUndefined()
    expect(SUPPORTED_PROPERTIES['color'].group).toBeUndefined()
    expect(SUPPORTED_PROPERTIES['opacity'].group).toBeUndefined()
  })

  it('assigns the right matching kind per property', () => {
    expect(SUPPORTED_PROPERTIES['padding-left'].kind).toBe('length')
    expect(SUPPORTED_PROPERTIES['color'].kind).toBe('color')
    expect(SUPPORTED_PROPERTIES['background-color'].kind).toBe('color')
    expect(SUPPORTED_PROPERTIES['border-color'].kind).toBe('color')
    expect(SUPPORTED_PROPERTIES['text-align'].kind).toBe('keyword')
    expect(SUPPORTED_PROPERTIES['border-style'].kind).toBe('keyword')
    expect(SUPPORTED_PROPERTIES['font-weight'].kind).toBe('number')
    expect(SUPPORTED_PROPERTIES['opacity'].kind).toBe('number')
    expect(SUPPORTED_PROPERTIES['box-shadow'].kind).toBe('shadow')
  })

  it('maps colour properties to the colors namespace', () => {
    expect(SUPPORTED_PROPERTIES['color'].namespace).toBe('colors')
    expect(SUPPORTED_PROPERTIES['background-color'].namespace).toBe('colors')
    expect(SUPPORTED_PROPERTIES['border-color'].namespace).toBe('colors')
  })

  it('derives a deduplicated namespace set for engine enumeration', () => {
    // No duplicates.
    expect(new Set(SUPPORTED_NAMESPACES).size).toBe(SUPPORTED_NAMESPACES.length)
    // Spot-check membership.
    for (const ns of ['spacing', 'colors', 'borderRadius', 'fontSize', 'opacity'] as const) {
      expect(SUPPORTED_NAMESPACES).toContain(ns)
    }
    // Every property's namespace is represented.
    for (const meta of Object.values(SUPPORTED_PROPERTIES)) {
      expect(SUPPORTED_NAMESPACES).toContain(meta.namespace)
    }
  })
})
