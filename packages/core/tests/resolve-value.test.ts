import { describe, it, expect } from 'vitest'
import { resolveValue } from '../src/tailwind/resolve-value'

// A stand-in for the engine's resolveThemeValue, matching the real v4 tokens we observed.
const tokens: Record<string, string> = {
  '--spacing': '0.25rem',
  '--radius-lg': '0.5rem',
  '--font-weight-bold': '700',
  '--color-red-500': 'oklch(63.7% 0.237 25.331)',
  '--text-base': '1rem',
}
const resolveToken = (t: string): string | undefined => tokens[t]
const resolve = (raw: string, rootFontSizePx?: number): string =>
  resolveValue(raw, { resolveToken, rootFontSizePx })

describe('resolveValue', () => {
  it('evaluates the spacing calc() shape Tailwind v4 emits', () => {
    expect(resolve('calc(var(--spacing) * 4)')).toBe('16px')
    expect(resolve('calc(var(--spacing) * 6)')).toBe('24px')
    expect(resolve('calc(var(--spacing) * 64)')).toBe('256px')
  })

  it('handles negative multipliers (negative margins)', () => {
    expect(resolve('calc(var(--spacing) * -4)')).toBe('-16px')
  })

  it('honors a non-default root font size', () => {
    expect(resolve('calc(var(--spacing) * 4)', 10)).toBe('10px')
    expect(resolve('1rem', 10)).toBe('10px')
  })

  it('converts standalone rem/em tokens to px', () => {
    expect(resolve('var(--radius-lg)')).toBe('8px')
    expect(resolve('0.5rem')).toBe('8px')
    expect(resolve('var(--text-base)')).toBe('16px')
  })

  it('passes through literal px and percentages unchanged', () => {
    expect(resolve('2px')).toBe('2px')
    expect(resolve('50%')).toBe('50%')
  })

  it('resolves number tokens (font-weight) without unit conversion', () => {
    expect(resolve('var(--font-weight-bold)')).toBe('700')
  })

  it('leaves colors and keywords for downstream normalization', () => {
    expect(resolve('var(--color-red-500)')).toBe('oklch(63.7% 0.237 25.331)')
    expect(resolve('center')).toBe('center')
    expect(resolve('dashed')).toBe('dashed')
  })

  it('uses the var() fallback when the token is unknown', () => {
    expect(resolve('var(--missing, 1rem)')).toBe('16px')
  })

  it('leaves an unresolvable var() in place rather than emitting garbage', () => {
    expect(resolve('var(--missing)')).toBe('var(--missing)')
  })

  it('evaluates +, -, and / calc() forms', () => {
    expect(resolve('calc(0.5rem + 0.5rem)')).toBe('16px')
    expect(resolve('calc(1rem - 0.5rem)')).toBe('8px')
    expect(resolve('calc(1rem / 2)')).toBe('8px')
  })

  it('falls back to the original string for calc() it cannot reduce', () => {
    // Mixing incompatible units is not reducible here; keep the input rather than guess.
    expect(resolve('calc(100% - 1rem)')).toBe('calc(100% - 1rem)')
  })
})
