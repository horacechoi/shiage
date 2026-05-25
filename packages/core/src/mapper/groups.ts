import type { PhysicalGroup, TailwindNamespace } from '../supported'

// Canonical Tailwind class-naming knowledge, shared by the engine-enumeration step (which classes
// to scan) and the mapper (how to name a class for a property). Kept dependency-free (types only)
// so both the tailwind adapters and the mapper can import it without cycles.

/** Class-name prefixes to scan per namespace when enumerating candidates from the engine. */
export const NAMESPACE_PREFIXES: Record<TailwindNamespace, readonly string[]> = {
  spacing: [
    'p',
    'px',
    'py',
    'pt',
    'pr',
    'pb',
    'pl',
    'm',
    'mx',
    'my',
    'mt',
    'mr',
    'mb',
    'ml',
    'gap',
    'gap-x',
    'gap-y',
  ],
  width: ['w'],
  height: ['h'],
  minWidth: ['min-w'],
  minHeight: ['min-h'],
  maxWidth: ['max-w'],
  maxHeight: ['max-h'],
  fontSize: ['text'],
  fontWeight: ['font'],
  lineHeight: ['leading'],
  letterSpacing: ['tracking'],
  textAlign: ['text'],
  colors: ['text', 'bg', 'border'],
  borderWidth: ['border'],
  borderRadius: ['rounded'],
  borderStyle: ['border'],
  opacity: ['opacity'],
  boxShadow: ['shadow'],
}

export function prefixesForNamespaces(namespaces: readonly TailwindNamespace[]): string[] {
  const set = new Set<string>()
  for (const ns of namespaces) for (const p of NAMESPACE_PREFIXES[ns]) set.add(p)
  return [...set]
}

/**
 * The single-side / canonical utility prefix for each supported longhand property. Used to build
 * arbitrary-value fallbacks (e.g. `padding-left` → `pl` → `pl-[23px]`) and, for grouped
 * properties, the per-side class the mapper recombines from.
 */
export const PROPERTY_PREFIX: Record<string, string> = {
  'padding-top': 'pt',
  'padding-right': 'pr',
  'padding-bottom': 'pb',
  'padding-left': 'pl',
  'margin-top': 'mt',
  'margin-right': 'mr',
  'margin-bottom': 'mb',
  'margin-left': 'ml',
  'row-gap': 'gap-y',
  'column-gap': 'gap-x',
  width: 'w',
  height: 'h',
  'min-width': 'min-w',
  'min-height': 'min-h',
  'max-width': 'max-w',
  'max-height': 'max-h',
  'font-size': 'text',
  'font-weight': 'font',
  'line-height': 'leading',
  'letter-spacing': 'tracking',
  'text-align': 'text',
  color: 'text',
  'background-color': 'bg',
  'border-color': 'border',
  'border-top-width': 'border-t',
  'border-right-width': 'border-r',
  'border-bottom-width': 'border-b',
  'border-left-width': 'border-l',
  'border-top-left-radius': 'rounded-tl',
  'border-top-right-radius': 'rounded-tr',
  'border-bottom-right-radius': 'rounded-br',
  'border-bottom-left-radius': 'rounded-bl',
  'border-style': 'border',
  opacity: 'opacity',
  'box-shadow': 'shadow',
}

export interface GroupTiling {
  /** Maps each of the group's physical longhands to a short side label. */
  longhandToSide: Record<string, string>
  /**
   * Combined-class prefixes by the exact set of sides they cover, ordered most-covering first so a
   * greedy tiler prefers shorthands (`p`) over axis (`px`) over single sides (`pl`).
   */
  combos: { sides: readonly string[]; prefix: string }[]
}

export const GROUP_TILINGS: Record<PhysicalGroup, GroupTiling> = {
  padding: {
    longhandToSide: {
      'padding-top': 'top',
      'padding-right': 'right',
      'padding-bottom': 'bottom',
      'padding-left': 'left',
    },
    combos: [
      { sides: ['top', 'right', 'bottom', 'left'], prefix: 'p' },
      { sides: ['left', 'right'], prefix: 'px' },
      { sides: ['top', 'bottom'], prefix: 'py' },
      { sides: ['top'], prefix: 'pt' },
      { sides: ['right'], prefix: 'pr' },
      { sides: ['bottom'], prefix: 'pb' },
      { sides: ['left'], prefix: 'pl' },
    ],
  },
  margin: {
    longhandToSide: {
      'margin-top': 'top',
      'margin-right': 'right',
      'margin-bottom': 'bottom',
      'margin-left': 'left',
    },
    combos: [
      { sides: ['top', 'right', 'bottom', 'left'], prefix: 'm' },
      { sides: ['left', 'right'], prefix: 'mx' },
      { sides: ['top', 'bottom'], prefix: 'my' },
      { sides: ['top'], prefix: 'mt' },
      { sides: ['right'], prefix: 'mr' },
      { sides: ['bottom'], prefix: 'mb' },
      { sides: ['left'], prefix: 'ml' },
    ],
  },
  borderWidth: {
    longhandToSide: {
      'border-top-width': 'top',
      'border-right-width': 'right',
      'border-bottom-width': 'bottom',
      'border-left-width': 'left',
    },
    combos: [
      { sides: ['top', 'right', 'bottom', 'left'], prefix: 'border' },
      { sides: ['left', 'right'], prefix: 'border-x' },
      { sides: ['top', 'bottom'], prefix: 'border-y' },
      { sides: ['top'], prefix: 'border-t' },
      { sides: ['right'], prefix: 'border-r' },
      { sides: ['bottom'], prefix: 'border-b' },
      { sides: ['left'], prefix: 'border-l' },
    ],
  },
  borderRadius: {
    longhandToSide: {
      'border-top-left-radius': 'tl',
      'border-top-right-radius': 'tr',
      'border-bottom-right-radius': 'br',
      'border-bottom-left-radius': 'bl',
    },
    combos: [
      { sides: ['tl', 'tr', 'br', 'bl'], prefix: 'rounded' },
      { sides: ['tl', 'tr'], prefix: 'rounded-t' },
      { sides: ['tr', 'br'], prefix: 'rounded-r' },
      { sides: ['br', 'bl'], prefix: 'rounded-b' },
      { sides: ['tl', 'bl'], prefix: 'rounded-l' },
      { sides: ['tl'], prefix: 'rounded-tl' },
      { sides: ['tr'], prefix: 'rounded-tr' },
      { sides: ['br'], prefix: 'rounded-br' },
      { sides: ['bl'], prefix: 'rounded-bl' },
    ],
  },
  gap: {
    longhandToSide: { 'row-gap': 'row', 'column-gap': 'column' },
    combos: [
      { sides: ['row', 'column'], prefix: 'gap' },
      { sides: ['column'], prefix: 'gap-x' },
      { sides: ['row'], prefix: 'gap-y' },
    ],
  },
}
