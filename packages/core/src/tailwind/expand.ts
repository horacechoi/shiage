import type { CssDecl } from './types'

// Maps a CSS property as Tailwind emits it (shorthands like `padding`, logical props like
// `padding-inline`) to the physical longhands in our supported set. The browser watcher reports
// physical longhands (padding-left, …), so we always invert toward those. Logical→physical
// assumes a left-to-right writing mode (the v1 assumption; RTL is out of scope).
const EXPANSIONS: Record<string, readonly string[]> = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'padding-inline': ['padding-left', 'padding-right'],
  'padding-block': ['padding-top', 'padding-bottom'],
  'padding-inline-start': ['padding-left'],
  'padding-inline-end': ['padding-right'],
  'padding-block-start': ['padding-top'],
  'padding-block-end': ['padding-bottom'],

  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  'margin-inline': ['margin-left', 'margin-right'],
  'margin-block': ['margin-top', 'margin-bottom'],
  'margin-inline-start': ['margin-left'],
  'margin-inline-end': ['margin-right'],
  'margin-block-start': ['margin-top'],
  'margin-block-end': ['margin-bottom'],

  gap: ['row-gap', 'column-gap'],

  'border-width': [
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
  ],
  'border-inline-width': ['border-left-width', 'border-right-width'],
  'border-block-width': ['border-top-width', 'border-bottom-width'],

  'border-radius': [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
  ],
  'border-start-start-radius': ['border-top-left-radius'],
  'border-start-end-radius': ['border-top-right-radius'],
  'border-end-end-radius': ['border-bottom-right-radius'],
  'border-end-start-radius': ['border-bottom-left-radius'],
}

/**
 * Expand a declaration whose property is a shorthand or logical property into the physical
 * longhands it sets, each carrying the same value. Properties that are already physical
 * longhands (or singletons like `width`, `color`) pass through unchanged.
 */
export function expandToPhysical(decl: CssDecl): CssDecl[] {
  const targets = EXPANSIONS[decl.property]
  if (!targets) return [decl]
  return targets.map((property) => ({ property, value: decl.value }))
}
