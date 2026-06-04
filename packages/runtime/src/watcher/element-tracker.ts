// One element's CSS-change state machine, with no timers and no observers — the manager (or the
// single-element wrapper) decides WHEN to call `ingest`, and the tracker just diffs a freshly-read
// snapshot against its baseline and decides what is a genuine user edit. A change is confirmed only
// if it has NO page-origin provenance:
//
//   • a programmatic inline write (provenance, from the patched style APIs — see provenance.ts),
//   • a class/attribute change ("broad" provenance),
//   • an active CSS animation/transition or Web Animation. The `getAnimatingProperties` probe
//     (`getAnimations()`) is the authority on what's animating right now; CSS transition/animation
//     events additionally pre-`taint` a property so that a transition which starts AND ends between
//     two polls is still absorbed (its taint persists until the probe confirms it has stopped).
//
// Anything page-origin is *absorbed* into the baseline (so it neither surfaces now nor resurfaces on
// a later poll); anything left is a DevTools edit, which goes through the original two-poll guard.
// The split from the manager exists so a single shared poll + observers can drive N elements — see
// watch-manager.ts.
import {
  WATCHED_PROPERTY_LIST,
  watchedPropertyFor,
  type SupportedProperty,
} from '@shiage/core/supported'
import type { PropertyChange } from '@shiage/core/protocol'
import { valuesEqual } from './normalize'
import {
  consumeProvenance as defaultConsumeProvenance,
  type ElementProvenance,
} from '../provenance'

type Snapshot = Map<SupportedProperty, string>

// Sizing properties whose computed value commonly shifts as a *side effect* of layout — growing
// padding on an auto-width element widens it; DevTools docking shrinks `100dvh` and every
// `min-h-screen` element's height drops; a parent's flex layout resizes children. We must not
// write any of that derived value back as a hardcoded `w-[Npx]` / `h-[Npx]`. The deliberate-edit
// signal is `authoredInline`: the user explicitly set the property on the element's own `style`
// attribute (the standard DevTools workflow for adding a property to a single element).
const DIMENSION_PROPERTIES: ReadonlySet<string> = new Set([
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
])

const EMPTY_ANIMATING: ReadonlySet<SupportedProperty> = new Set()

/** Currently-animating watched properties, or `'all'` when the set can't be resolved. */
export type AnimatingProperties = ReadonlySet<SupportedProperty> | 'all'

export interface ElementTrackerOptions {
  /** Snapshot every supported property's current computed value. Injectable for tests; defaults to
   * a single `getComputedStyle(element)` read per call. */
  readAll?: () => Snapshot
  /** Read+clear the element's programmatic-mutation markers. Injectable for tests; defaults to the
   * real provenance store (empty unless `installProvenance()` ran). */
  consumeProvenance?: (el: Element) => ElementProvenance
  /** The watched properties currently under an active animation/transition on this element, or
   * `'all'`. Injectable for tests; defaults to reading `element.getAnimations()` (empty when
   * unavailable, e.g. happy-dom). */
  getAnimatingProperties?: () => AnimatingProperties
}

export interface ElementTracker {
  readonly element: Element
  /** Read a fresh snapshot, diff against baseline, and update the confirmed set. Page-origin
   * divergences (provenance / animation) are absorbed into the baseline; the rest follow the
   * stability rule: `immediate=true` (MutationObserver path) confirms any diff at once,
   * `immediate=false` (poll path) requires the value to also match the previous poll. Returns true
   * if the confirmed set changed in any way. */
  ingest(immediate: boolean): boolean
  /** The confirmed property changes vs. the baseline, ready for the save message. */
  getCurrentChanges(): PropertyChange[]
  /** Mark `property` (or the whole element) as animation-driven, blocking its confirmation and
   * dropping any already-confirmed entry. The taint persists until a subsequent `ingest` sees the
   * animation probe report it as stopped (then its settled value is absorbed). Returns true if a
   * confirmed entry was dropped (so the caller can fire onChange). */
  taint(property: SupportedProperty | 'all'): boolean
  /** Whether any animation taint is currently set. */
  hasTaint(): boolean
  /** Re-snapshot the baseline and clear changes + taint (call after a successful apply). Does NOT
   * fire any callback — the caller owns its own onChange. */
  rebaseline(): void
}

function defaultGetAnimatingProperties(element: Element): () => AnimatingProperties {
  return () => {
    const el = element as Element & {
      getAnimations?: (options?: { subtree?: boolean }) => Animation[]
    }
    if (typeof el.getAnimations !== 'function') return EMPTY_ANIMATING
    const out = new Set<SupportedProperty>()
    let unintrospectable = false
    for (const anim of el.getAnimations()) {
      const state = anim.playState
      // 'running' (and 'paused' mid-fill) owns the properties; 'finished'/'idle' has released them.
      if (state === 'finished' || state === 'idle') continue
      const effect = anim.effect as KeyframeEffect | null
      if (!effect || typeof effect.getKeyframes !== 'function') {
        unintrospectable = true
        continue
      }
      for (const frame of effect.getKeyframes()) {
        for (const key of Object.keys(frame)) {
          if (
            key === 'offset' ||
            key === 'computedOffset' ||
            key === 'easing' ||
            key === 'composite'
          )
            continue
          const kebab = key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
          const watched = watchedPropertyFor(kebab)
          if (watched) out.add(watched)
        }
      }
      // Keys that map to nothing watched (e.g. `transform`) are simply ignored — that animation
      // affects no tracked property, so it needn't suppress anything.
    }
    // A running animation we couldn't introspect at all → suppress the whole element for its
    // duration (conservative: better than recording an animated frame).
    if (unintrospectable) return 'all'
    return out
  }
}

export function createElementTracker(
  element: Element,
  options: ElementTrackerOptions = {},
): ElementTracker {
  const readAll =
    options.readAll ??
    (() => {
      const cs = getComputedStyle(element)
      const snap: Snapshot = new Map()
      for (const property of WATCHED_PROPERTY_LIST) {
        snap.set(property, cs.getPropertyValue(property))
      }
      return snap
    })
  const consumeProvenance = options.consumeProvenance ?? defaultConsumeProvenance
  const getAnimatingProperties =
    options.getAnimatingProperties ?? defaultGetAnimatingProperties(element)

  let baseline = readAll()
  // Confirmed changes: property → current value (differs from baseline, past the stability guard).
  const confirmed = new Map<SupportedProperty, string>()
  // Value seen on the previous poll, for the two-poll stability guard.
  let lastPoll: Snapshot = new Map(baseline)
  // Animation taint, seeded by CSS transition/animation events; persists until the probe clears it.
  const tainted = new Set<SupportedProperty>()
  let taintedAll = false

  // True when `property` is set directly on the element's own inline style with a CONCRETE value —
  // the signal that the user deliberately edited it in DevTools, as opposed to it being
  // computed/derived. A `var()` inline value is excluded: its computed result follows custom
  // properties the app animates (so it's app-driven, not the concrete value a DevTools edit types),
  // and treating it as a protected edit would wrongly shield it from a custom-property write's
  // "broad" provenance.
  function authoredInline(property: string): boolean {
    const style = (element as Partial<ElementCSSInlineStyle>).style
    if (!style) return false
    const value = style.getPropertyValue(property)
    return value !== '' && !value.includes('var(')
  }

  function ingest(immediate: boolean): boolean {
    const current = readAll()
    const prov = consumeProvenance(element)

    // The animation probe (getAnimations) is the costlier read, so only consult it when something
    // actually diverges or the element is already tainted — static elements take the cheap path.
    let anyDiverged = false
    for (const property of WATCHED_PROPERTY_LIST) {
      if (!valuesEqual(property, baseline.get(property) ?? '', current.get(property) ?? '')) {
        anyDiverged = true
        break
      }
    }
    const needProbe = anyDiverged || taintedAll || tainted.size > 0
    const probe = needProbe ? getAnimatingProperties() : EMPTY_ANIMATING
    const probeAll = probe === 'all'
    const probeSet = probeAll ? null : probe

    // Seed taint from the probe so a property the probe reports animating persists as tainted into
    // the NEXT ingest — covering a transition that ends in the gap between this poll and the next
    // (the next ingest then absorbs its settled value before un-tainting it, below).
    if (probeAll) taintedAll = true
    else if (probeSet) for (const property of probeSet) tainted.add(property)

    let changed = false
    for (const property of WATCHED_PROPERTY_LIST) {
      const now = current.get(property) ?? ''
      const base = baseline.get(property) ?? ''
      if (valuesEqual(property, base, now)) {
        if (confirmed.delete(property)) changed = true
      } else {
        const styleMarked = prov.props.has(property)
        // A class/attr change makes any computed divergence app-origin — except a property the user
        // authored inline in DevTools without a JS write to it (that's a real edit to protect).
        const broadMarked = prov.broad && !(authoredInline(property) && !styleMarked)
        const animating =
          taintedAll || tainted.has(property) || probeAll || (probeSet?.has(property) ?? false)
        if (styleMarked || broadMarked || animating) {
          // Page-origin: absorb into the baseline so it neither surfaces now nor resurfaces later.
          baseline.set(property, now)
          if (confirmed.delete(property)) changed = true
        } else {
          const stable = immediate || valuesEqual(property, lastPoll.get(property) ?? '', now)
          if (stable && confirmed.get(property) !== now) {
            confirmed.set(property, now)
            changed = true
          }
        }
      }
      lastPoll.set(property, now)
    }

    // Drop taint for properties the probe confirms are no longer animating. Their settled value (if
    // it diverged) was just absorbed above, so the next ingest sees no divergence — no phantom. The
    // event-seeded taint persists across ingests until this clears it, which is what catches a
    // transition that started and ended entirely between two polls.
    if (needProbe && !probeAll) {
      if (tainted.size > 0) {
        for (const property of [...tainted]) {
          if (!probeSet?.has(property)) tainted.delete(property)
        }
      }
      if (taintedAll && (probeSet?.size ?? 0) === 0) taintedAll = false
    }

    return changed
  }

  return {
    element,
    ingest,
    getCurrentChanges() {
      // Drop every dimension change the element didn't author inline. Layout cascades it freely:
      // a sibling's padding edit reflows it, DevTools docking shrinks `100dvh` and `min-h-screen`
      // elements collapse, a media-query flip resizes it. None of those are user edits, and
      // pinning them into source as `w-[Npx]` / `h-[Npx]` is the bug we keep hitting. A dimension
      // the user explicitly typed into the `element.style {}` block in DevTools is the only
      // signal we can trust — that survives.
      const changes: PropertyChange[] = []
      for (const [property, newValue] of confirmed) {
        if (DIMENSION_PROPERTIES.has(property) && !authoredInline(property)) continue
        changes.push({ property, oldValue: baseline.get(property) ?? '', newValue })
      }
      return changes
    },
    taint(property) {
      if (property === 'all') {
        taintedAll = true
        const had = confirmed.size > 0
        confirmed.clear()
        return had
      }
      tainted.add(property)
      return confirmed.delete(property)
    },
    hasTaint() {
      return taintedAll || tainted.size > 0
    },
    rebaseline() {
      baseline = readAll()
      confirmed.clear()
      lastPoll = new Map(baseline)
      tainted.clear()
      taintedAll = false
    },
  }
}
