// Origin instrumentation — the page-side half of "record only what the user changed in DevTools".
//
// DevTools applies style/class edits through the browser's inspector backend, which does NOT run
// page JavaScript. Every *other* source of style mutation — app code, animation libraries, React
// re-renders — flows through the page's JS APIs (`style.setProperty`, the per-property setters,
// `classList`, `setAttribute`, …). So we patch those APIs: each call tags its element with the
// property (or "broad", for class/attr changes that can affect any computed value). The tracker
// then absorbs any divergence that carries a tag into the baseline (it's the app's doing), and
// records only un-tagged divergences — which is exactly what a DevTools edit produces. See
// element-tracker.ts for how the tag is consumed.
//
// `installProvenance()` must run before app code (index.ts calls it at the top of the IIFE, before
// `boot()`), so the patches are live before any library caches a method reference. It is dev-only
// by construction (the runtime is only injected in dev), idempotent, and fully reversible via
// `uninstallProvenance()`. The `style` / `classList` getters are patched too, only to record a
// declaration→element / tokenList→element back-reference, since the method patches run with `this`
// bound to the declaration / token list rather than the element.
import {
  SHORTHAND_PROPERTIES,
  WATCHED_PROPERTY_LIST,
  type SupportedProperty,
} from '@shiage/core/supported'

/** Programmatic-mutation markers accrued for one element since the last consume. */
export interface ElementProvenance {
  /** Specific watched style properties written inline by page JS. */
  props: Set<SupportedProperty>
  /** A class/attribute change — or a shorthand / `cssText` write — that could affect any computed
   * property on the element. */
  broad: boolean
}

const WATCHED = new Set<string>(WATCHED_PROPERTY_LIST)

// element → markers (WeakMap so detached nodes are collectable).
const store = new WeakMap<Element, ElementProvenance>()
// Back-references populated by the patched `style` / `classList` getters.
const declToEl = new WeakMap<CSSStyleDeclaration, Element>()
const tokenListToEl = new WeakMap<DOMTokenList, Element>()
// One stable Proxy per real inline-style declaration (so `el.style === el.style` holds).
const styleProxyCache = new WeakMap<CSSStyleDeclaration, CSSStyleDeclaration>()

// Returned when an element has no markers — shared to avoid per-ingest allocation. Callers read
// only (the tracker never mutates it).
const EMPTY: ElementProvenance = { props: new Set(), broad: false }

function entry(el: Element): ElementProvenance {
  let p = store.get(el)
  if (!p) {
    p = { props: new Set(), broad: false }
    store.set(el, p)
  }
  return p
}

function markStyleProp(el: Element | undefined, rawName: string): void {
  if (!el) return
  const name = rawName.trim().toLowerCase()
  if (WATCHED.has(name)) entry(el).props.add(name as SupportedProperty)
  // A shorthand (`padding`) maps to watched longhands, and a custom property (`--x`) can feed any
  // watched value via `var()` — either way the resulting computed change is the app's doing, so
  // mark broad. Other unsupported properties (transform, …) can't surface, so are ignored.
  else if (name.startsWith('--') || SHORTHAND_PROPERTIES.has(name as SupportedProperty))
    entry(el).broad = true
}

function markBroad(el: Element | undefined): void {
  if (el) entry(el).broad = true
}

// Mark every property named in an inline-style text (a `cssText` or `setAttribute('style', …)`
// write). Best-effort split — sufficient for the watched longhands these writes carry.
function markStyleText(el: Element | undefined, text: string): void {
  if (!el || !text) return
  for (const decl of text.split(';')) {
    const colon = decl.indexOf(':')
    if (colon > 0) markStyleProp(el, decl.slice(0, colon))
  }
}

/** Read and clear the markers accrued for `el`. Called once per `ingest`. */
export function consumeProvenance(el: Element): ElementProvenance {
  const p = store.get(el)
  if (!p) return EMPTY
  store.delete(el)
  return p
}

// ── Patch installation ──────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any

let installed = false
const restorers: Array<() => void> = []

function patchValue(proto: object, name: string, make: (orig: AnyFn) => AnyFn): void {
  const desc = Object.getOwnPropertyDescriptor(proto, name)
  if (!desc || typeof desc.value !== 'function') return
  const orig = desc.value as AnyFn
  Object.defineProperty(proto, name, { ...desc, value: make(orig) })
  restorers.push(() => Object.defineProperty(proto, name, desc))
}

function patchSetter(
  proto: object,
  name: string,
  make: (origSet: (v: any) => void) => (v: any) => void,
): void {
  const desc = Object.getOwnPropertyDescriptor(proto, name)
  if (!desc || typeof desc.set !== 'function') return
  const origSet = desc.set
  Object.defineProperty(proto, name, { ...desc, set: make(origSet) })
  restorers.push(() => Object.defineProperty(proto, name, desc))
}

function recordGetter(proto: object, name: string, remember: (result: any, el: any) => void): void {
  const desc = Object.getOwnPropertyDescriptor(proto, name)
  if (!desc || typeof desc.get !== 'function') return
  const origGet = desc.get
  Object.defineProperty(proto, name, {
    ...desc,
    get(this: any) {
      const result = origGet.call(this)
      remember(result, this)
      return result
    },
  })
  restorers.push(() => Object.defineProperty(proto, name, desc))
}

const toKebab = (prop: string): string =>
  prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

// Wrap a real inline-style declaration so writes through it are tagged. Catching a per-property
// accessor write (`el.style.opacity = …`) needs this: in Chrome those properties are native
// named-properties on the style INSTANCE (not JS accessors on the prototype, and not routed through
// `setProperty`), so the only reliable interception point is the object `el.style` returns.
function wrapStyle(real: CSSStyleDeclaration, el: Element): CSSStyleDeclaration {
  const cached = styleProxyCache.get(real)
  if (cached) return cached
  const proxy = new Proxy(real, {
    get(target, prop) {
      const value = (target as any)[prop]
      // Methods (setProperty, getPropertyValue, …) must run with `this` = the real declaration.
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, prop, value) {
      if (typeof prop === 'string') {
        if (prop === 'cssText') markStyleText(el, String(value ?? ''))
        else markStyleProp(el, toKebab(prop))
      }
      ;(target as any)[prop] = value
      return true
    },
  }) as CSSStyleDeclaration
  styleProxyCache.set(real, proxy)
  return proxy
}

// Patch an element prototype's `style` getter to return the wrapping Proxy (and record decl→element
// so the method patches, invoked via the proxy's bound methods, can attribute their writes).
function patchStyleGetter(proto: object): void {
  const desc = Object.getOwnPropertyDescriptor(proto, 'style')
  if (!desc || typeof desc.get !== 'function') return
  const origGet = desc.get
  Object.defineProperty(proto, 'style', {
    ...desc,
    get(this: Element) {
      const real = origGet.call(this) as CSSStyleDeclaration
      declToEl.set(real, this)
      return wrapStyle(real, this)
    },
  })
  restorers.push(() => Object.defineProperty(proto, 'style', desc))
}

export function installProvenance(): void {
  if (installed) return
  if (typeof CSSStyleDeclaration === 'undefined' || typeof Element === 'undefined') return
  installed = true

  // Proxy `el.style` so per-property accessor writes (`el.style.opacity = …`) are tagged — the path
  // that bypasses both `setProperty` and any prototype accessor in real browsers. Also records
  // decl→element for the method patches below.
  for (const Ctor of [
    typeof HTMLElement !== 'undefined' ? HTMLElement : undefined,
    typeof SVGElement !== 'undefined' ? SVGElement : undefined,
  ]) {
    if (Ctor) patchStyleGetter(Ctor.prototype)
  }
  // classList → element, for the DOMTokenList patches.
  recordGetter(Element.prototype, 'classList', (list: DOMTokenList, el: Element) => {
    if (list && !tokenListToEl.has(list)) tokenListToEl.set(list, el)
  })

  // ── Inline style writes ──
  patchValue(
    CSSStyleDeclaration.prototype,
    'setProperty',
    (orig) =>
      function (this: CSSStyleDeclaration, name: string, ...rest: any[]) {
        markStyleProp(declToEl.get(this), name)
        return orig.call(this, name, ...rest)
      },
  )
  patchValue(
    CSSStyleDeclaration.prototype,
    'removeProperty',
    (orig) =>
      function (this: CSSStyleDeclaration, name: string, ...rest: any[]) {
        markStyleProp(declToEl.get(this), name)
        return orig.call(this, name, ...rest)
      },
  )
  patchSetter(
    CSSStyleDeclaration.prototype,
    'cssText',
    (origSet) =>
      function (this: CSSStyleDeclaration, v: any) {
        markStyleText(declToEl.get(this), String(v ?? ''))
        origSet.call(this, v)
      },
  )
  // ── Class / attribute writes ──
  patchValue(
    Element.prototype,
    'setAttribute',
    (orig) =>
      function (this: Element, name: string, value: string, ...rest: any[]) {
        if (String(name).toLowerCase() === 'style') markStyleText(this, String(value ?? ''))
        else markBroad(this)
        return orig.call(this, name, value, ...rest)
      },
  )
  patchValue(
    Element.prototype,
    'removeAttribute',
    (orig) =>
      function (this: Element, name: string, ...rest: any[]) {
        markBroad(this)
        return orig.call(this, name, ...rest)
      },
  )
  patchValue(
    Element.prototype,
    'toggleAttribute',
    (orig) =>
      function (this: Element, name: string, ...rest: any[]) {
        markBroad(this)
        return orig.call(this, name, ...rest)
      },
  )
  patchSetter(
    Element.prototype,
    'className',
    (origSet) =>
      function (this: Element, v: any) {
        markBroad(this)
        origSet.call(this, v)
      },
  )
  // happy-dom (the test env) does not expose DOMTokenList globally; guard so install is a no-op for
  // this patch there (the classList path is validated live in a real browser).
  if (typeof DOMTokenList !== 'undefined') {
    for (const method of ['add', 'remove', 'toggle', 'replace'] as const) {
      patchValue(
        DOMTokenList.prototype,
        method,
        (orig) =>
          function (this: DOMTokenList, ...args: any[]) {
            markBroad(tokenListToEl.get(this))
            return orig.apply(this, args)
          },
      )
    }
  }
}

export function uninstallProvenance(): void {
  if (!installed) return
  for (let i = restorers.length - 1; i >= 0; i--) restorers[i]!()
  restorers.length = 0
  installed = false
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Test-only: whether the patches are currently installed. */
export function isProvenanceInstalled(): boolean {
  return installed
}
