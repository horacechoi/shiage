// The single source of truth for the CSS properties Shiage can map in v1.
//
// Everything keys off this table: the browser runtime imports SUPPORTED_PROPERTY_LIST to know
// which computed-style properties to snapshot and watch; the reverse-lookup builder enumerates the
// namespaces here; and the mapper uses `kind` to choose a matching strategy and arbitrary-value
// format, and `group` to decide directional decomposition. SUPPORTED_PROPERTIES.md is generated
// from this table, so the docs can never drift from the code.
//
// The supported set is defined in SHIAGE_BUILD_PLAN.md §7.

/** Tailwind theme namespaces that v1 utilities draw from. Used to scope engine enumeration. */
export type TailwindNamespace =
  | 'spacing'
  | 'width'
  | 'height'
  | 'minWidth'
  | 'minHeight'
  | 'maxWidth'
  | 'maxHeight'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textAlign'
  | 'colors'
  | 'borderWidth'
  | 'borderRadius'
  | 'borderStyle'
  | 'opacity'
  | 'boxShadow'

/** Physical groups whose longhands the mapper may decompose/recombine directionally. */
export type PhysicalGroup = 'padding' | 'margin' | 'borderWidth' | 'borderRadius' | 'gap'

/** How the mapper matches a computed value to a class and formats an arbitrary-value fallback. */
export type PropertyKind = 'length' | 'color' | 'keyword' | 'number' | 'shadow'

export interface PropertyMeta {
  /** The Tailwind theme namespace whose utilities produce this property. */
  readonly namespace: TailwindNamespace
  /** How values for this property are matched and formatted. */
  readonly kind: PropertyKind
  /** Physical group, when this longhand participates in directional decomposition. */
  readonly group?: PhysicalGroup
}

/**
 * Defines the property table while preserving the exact key union (so `SupportedProperty` stays
 * specific) but widening each value to `PropertyMeta` — so `.group` is uniformly accessible
 * (optional) and `.kind` / `.namespace` are their full unions, not per-entry literal types.
 */
function defineProperties<const T extends Record<string, PropertyMeta>>(
  table: T,
): { readonly [K in keyof T]: PropertyMeta } {
  return table
}

export const SUPPORTED_PROPERTIES = defineProperties({
  // ── Spacing: padding ──
  padding: { namespace: 'spacing', kind: 'length', group: 'padding' },
  'padding-top': { namespace: 'spacing', kind: 'length', group: 'padding' },
  'padding-right': { namespace: 'spacing', kind: 'length', group: 'padding' },
  'padding-bottom': { namespace: 'spacing', kind: 'length', group: 'padding' },
  'padding-left': { namespace: 'spacing', kind: 'length', group: 'padding' },
  // ── Spacing: margin ──
  margin: { namespace: 'spacing', kind: 'length', group: 'margin' },
  'margin-top': { namespace: 'spacing', kind: 'length', group: 'margin' },
  'margin-right': { namespace: 'spacing', kind: 'length', group: 'margin' },
  'margin-bottom': { namespace: 'spacing', kind: 'length', group: 'margin' },
  'margin-left': { namespace: 'spacing', kind: 'length', group: 'margin' },
  // ── Spacing: gap ──
  gap: { namespace: 'spacing', kind: 'length', group: 'gap' },
  'row-gap': { namespace: 'spacing', kind: 'length', group: 'gap' },
  'column-gap': { namespace: 'spacing', kind: 'length', group: 'gap' },
  // ── Sizing ──
  width: { namespace: 'width', kind: 'length' },
  height: { namespace: 'height', kind: 'length' },
  'min-width': { namespace: 'minWidth', kind: 'length' },
  'min-height': { namespace: 'minHeight', kind: 'length' },
  'max-width': { namespace: 'maxWidth', kind: 'length' },
  'max-height': { namespace: 'maxHeight', kind: 'length' },
  // ── Typography ──
  'font-size': { namespace: 'fontSize', kind: 'length' },
  'font-weight': { namespace: 'fontWeight', kind: 'number' },
  'line-height': { namespace: 'lineHeight', kind: 'length' },
  'letter-spacing': { namespace: 'letterSpacing', kind: 'length' },
  'text-align': { namespace: 'textAlign', kind: 'keyword' },
  color: { namespace: 'colors', kind: 'color' },
  // ── Background ──
  'background-color': { namespace: 'colors', kind: 'color' },
  // ── Border width ──
  'border-width': { namespace: 'borderWidth', kind: 'length', group: 'borderWidth' },
  'border-top-width': { namespace: 'borderWidth', kind: 'length', group: 'borderWidth' },
  'border-right-width': { namespace: 'borderWidth', kind: 'length', group: 'borderWidth' },
  'border-bottom-width': { namespace: 'borderWidth', kind: 'length', group: 'borderWidth' },
  'border-left-width': { namespace: 'borderWidth', kind: 'length', group: 'borderWidth' },
  // ── Border color ──
  'border-color': { namespace: 'colors', kind: 'color' },
  // ── Border radius ──
  'border-radius': { namespace: 'borderRadius', kind: 'length', group: 'borderRadius' },
  'border-top-left-radius': { namespace: 'borderRadius', kind: 'length', group: 'borderRadius' },
  'border-top-right-radius': { namespace: 'borderRadius', kind: 'length', group: 'borderRadius' },
  'border-bottom-right-radius': {
    namespace: 'borderRadius',
    kind: 'length',
    group: 'borderRadius',
  },
  'border-bottom-left-radius': { namespace: 'borderRadius', kind: 'length', group: 'borderRadius' },
  // ── Border style ──
  'border-style': { namespace: 'borderStyle', kind: 'keyword' },
  // ── Effects ──
  opacity: { namespace: 'opacity', kind: 'number' },
  'box-shadow': { namespace: 'boxShadow', kind: 'shadow' },
})

export type SupportedProperty = keyof typeof SUPPORTED_PROPERTIES

export const SUPPORTED_PROPERTY_LIST = Object.keys(
  SUPPORTED_PROPERTIES,
) as readonly SupportedProperty[]

export function isSupportedProperty(property: string): property is SupportedProperty {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_PROPERTIES, property)
}

/** The unique set of namespaces v1 properties draw from; drives engine enumeration. */
export const SUPPORTED_NAMESPACES: readonly TailwindNamespace[] = [
  ...new Set(Object.values(SUPPORTED_PROPERTIES).map((meta) => meta.namespace)),
]
