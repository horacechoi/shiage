// Value normalization for change detection. The watcher compares a property's baseline computed
// value against its current one to decide "did this change?"; raw `getComputedStyle` strings need
// kind-aware comparison so sub-pixel noise and whitespace differences don't register as edits.
// (The server re-parses values for the actual class mapping — this is only about detecting change.)
import { SUPPORTED_PROPERTIES, type SupportedProperty } from '@shiage/core/supported'

/** Computed lengths within this many px are treated as equal — guards against layout sub-pixel
 * noise (e.g. 23.999px vs 24px) that isn't a real edit. */
export const LENGTH_EPSILON_PX = 0.5

/** Parse a pure-px computed value to a number, or null for non-px values (`normal`, `auto`, a
 * unitless line-height, a color, …). */
export function parsePx(value: string): number | null {
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim())
  return match ? Number(match[1]) : null
}

/** Collapse whitespace and case so `rgb(239, 68, 68)` and `RGB(239,68,68)` compare equal. */
function normalizeColor(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

/**
 * Whether two computed values for `property` represent the same styling. Length properties compare
 * within {@link LENGTH_EPSILON_PX}; colors compare whitespace/case-insensitively; everything else
 * compares as trimmed strings.
 */
export function valuesEqual(property: SupportedProperty, a: string, b: string): boolean {
  if (a === b) return true
  const { kind } = SUPPORTED_PROPERTIES[property]
  if (kind === 'length') {
    const pa = parsePx(a)
    const pb = parsePx(b)
    if (pa !== null && pb !== null) return Math.abs(pa - pb) < LENGTH_EPSILON_PX
    return a.trim() === b.trim()
  }
  if (kind === 'color') return normalizeColor(a) === normalizeColor(b)
  return a.trim() === b.trim()
}
