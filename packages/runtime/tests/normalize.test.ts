import { describe, it, expect } from 'vitest'
import { parsePx, valuesEqual, LENGTH_EPSILON_PX } from '../src/watcher/normalize'

describe('parsePx', () => {
  it('parses pure-px values, including negatives and decimals', () => {
    expect(parsePx('24px')).toBe(24)
    expect(parsePx('-4px')).toBe(-4)
    expect(parsePx('24.5px')).toBe(24.5)
    expect(parsePx('0px')).toBe(0)
    expect(parsePx('  16px ')).toBe(16)
  })

  it('returns null for non-px values', () => {
    expect(parsePx('normal')).toBeNull()
    expect(parsePx('auto')).toBeNull()
    expect(parsePx('1.5rem')).toBeNull()
    expect(parsePx('rgb(0, 0, 0)')).toBeNull()
    expect(parsePx('0')).toBeNull()
  })
})

describe('valuesEqual', () => {
  it('treats lengths within the sub-pixel epsilon as equal', () => {
    expect(LENGTH_EPSILON_PX).toBe(0.5)
    expect(valuesEqual('padding-left', '24px', '24px')).toBe(true)
    expect(valuesEqual('padding-left', '24px', '23.999px')).toBe(true)
    expect(valuesEqual('padding-left', '24px', '24.4px')).toBe(true)
    expect(valuesEqual('padding-left', '24px', '23px')).toBe(false)
    expect(valuesEqual('padding-left', '16px', '24px')).toBe(false)
  })

  it('compares non-px lengths as trimmed strings', () => {
    expect(valuesEqual('line-height', 'normal', 'normal')).toBe(true)
    expect(valuesEqual('line-height', 'normal', '24px')).toBe(false)
  })

  it('compares colors whitespace- and case-insensitively', () => {
    expect(valuesEqual('color', 'rgb(239, 68, 68)', 'rgb(239,68,68)')).toBe(true)
    expect(valuesEqual('color', 'RGB(239, 68, 68)', 'rgb(239,68,68)')).toBe(true)
    expect(valuesEqual('color', 'rgb(0, 0, 0)', 'rgb(255, 0, 0)')).toBe(false)
  })

  it('compares keywords and numbers exactly (trimmed)', () => {
    expect(valuesEqual('text-align', 'center', 'center')).toBe(true)
    expect(valuesEqual('text-align', 'left', 'center')).toBe(false)
    expect(valuesEqual('font-weight', '700', '700')).toBe(true)
    expect(valuesEqual('opacity', '0.5', '0.6')).toBe(false)
  })
})
