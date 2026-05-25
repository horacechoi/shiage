import { describe, it, expect } from 'vitest'
import { parseColor, rgbToKey, colorDistance, type Rgb } from '../src/color'

const px = (input: string): Rgb => {
  const c = parseColor(input)
  if (!c) throw new Error(`expected a color from ${input}`)
  return c
}

describe('parseColor', () => {
  it('parses rgb()/rgba() in comma and space syntax', () => {
    expect(px('rgb(239, 68, 68)')).toEqual({ r: 239, g: 68, b: 68, a: 1 })
    expect(px('rgb(239 68 68)')).toEqual({ r: 239, g: 68, b: 68, a: 1 })
    expect(px('rgba(239, 68, 68, 0.5)')).toEqual({ r: 239, g: 68, b: 68, a: 0.5 })
    expect(px('rgb(239 68 68 / 50%)')).toEqual({ r: 239, g: 68, b: 68, a: 0.5 })
  })

  it('parses hex in 3/4/6/8 digit forms (case-insensitive)', () => {
    expect(px('#ef4444')).toEqual({ r: 239, g: 68, b: 68, a: 1 })
    expect(px('#EF4444')).toEqual({ r: 239, g: 68, b: 68, a: 1 })
    expect(px('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(px('#ff5500')).toEqual({ r: 255, g: 85, b: 0, a: 1 })
    expect(px('#ff550080').a).toBeCloseTo(0.502, 2)
  })

  it('parses hsl()', () => {
    expect(px('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(px('hsl(120 100% 50%)')).toEqual({ r: 0, g: 255, b: 0, a: 1 })
  })

  it('converts oklch endpoints correctly (white/black)', () => {
    expect(px('oklch(1 0 0)')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(px('oklch(0 0 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })

  it('converts a v4 oklch theme color to the rgb the browser would compute', () => {
    // Tailwind v4 red-500 = oklch(63.7% 0.237 25.331) ≈ #fb2c36 = rgb(251, 44, 54).
    const fromDecimal = px('oklch(0.637 0.237 25.331)')
    const fromPercent = px('oklch(63.7% 0.237 25.331)')
    expect(fromDecimal).toEqual(fromPercent)
    expect(colorDistance(fromDecimal, { r: 251, g: 44, b: 54, a: 1 })).toBeLessThan(6)
  })

  it('handles transparent and rejects non-colors', () => {
    expect(px('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseColor('currentColor')).toBeNull()
    expect(parseColor('not-a-color')).toBeNull()
    expect(parseColor('#xyz')).toBeNull()
  })
})

describe('rgbToKey', () => {
  it('drops alpha when opaque, keeps it otherwise', () => {
    expect(rgbToKey({ r: 239, g: 68, b: 68, a: 1 })).toBe('rgb(239, 68, 68)')
    expect(rgbToKey({ r: 239, g: 68, b: 68, a: 0.5 })).toBe('rgba(239, 68, 68, 0.5)')
  })
})

describe('colorDistance', () => {
  it('is zero for equal colors and grows with difference', () => {
    expect(colorDistance({ r: 1, g: 2, b: 3, a: 1 }, { r: 1, g: 2, b: 3, a: 1 })).toBe(0)
    expect(colorDistance({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 0, b: 0, a: 1 })).toBe(255)
  })
})
