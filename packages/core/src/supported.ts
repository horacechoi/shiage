// The single source of truth for the CSS properties Shiage can map in v1.
//
// Everything keys off this table: the browser runtime imports SUPPORTED_PROPERTY_LIST to know
// which computed-style properties to snapshot and watch; the reverse-lookup builder enumerates the
// namespaces here; and the mapper uses `kind` to choose a matching strategy and arbitrary-value
// format, and `group` to decide directional decomposition. SUPPORTED_PROPERTIES.md is generated
// from this table, so the docs can never drift from the code.

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

// Box-model/gap/radius shorthands. `getComputedStyle` resolves every value to its longhands, so a
// shorthand's computed string is just a redundant reflection of them — editing `padding-left` also
// "changes" `padding`. The watcher diffs longhands only and skips these to avoid double-counting;
// the provenance instrumentation treats a write to one as affecting its (watched) longhands.
export const SHORTHAND_PROPERTIES: ReadonlySet<SupportedProperty> = new Set<SupportedProperty>([
  'padding',
  'margin',
  'gap',
  'border-width',
  'border-radius',
])

/** The properties the watcher actually diffs: every supported one except the shorthands above. */
export const WATCHED_PROPERTY_LIST: readonly SupportedProperty[] = SUPPORTED_PROPERTY_LIST.filter(
  (p) => !SHORTHAND_PROPERTIES.has(p),
)

// CSS transitions and the Web Animations API operate on longhands, so a `border-color` transition
// fires events / keyframes for `border-{side}-color` — none of which Shiage watches (it watches the
// `border-color` shorthand, whose computed value those longhands drive). Map them back.
const BORDER_COLOR_LONGHANDS: ReadonlySet<string> = new Set([
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
])

/** The watched property an animated/transitioned property name maps to (e.g. `border-top-color` →
 * `border-color`), or null when it doesn't affect any watched property (e.g. `transform`). Used to
 * attribute animation events and keyframes to the property the watcher actually diffs. */
export function watchedPropertyFor(property: string): SupportedProperty | null {
  if (isSupportedProperty(property) && !SHORTHAND_PROPERTIES.has(property)) return property
  if (BORDER_COLOR_LONGHANDS.has(property)) return 'border-color'
  return null
}

/** The unique set of namespaces v1 properties draw from; drives engine enumeration. */
export const SUPPORTED_NAMESPACES: readonly TailwindNamespace[] = [
  ...new Set(Object.values(SUPPORTED_PROPERTIES).map((meta) => meta.namespace)),
]
