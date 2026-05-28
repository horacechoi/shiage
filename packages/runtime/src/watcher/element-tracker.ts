// One element's CSS-change state machine, with no timers and no observers — the manager (or the
// single-element wrapper) decides WHEN to call `ingest`, and the tracker just diffs a freshly-read
// snapshot against its baseline and decides what passes the stability guard. Everything that was
// closure-local in the original `createWatcher` lives here, in the same shape: a `baseline` of
// computed values at start, a `confirmed` set of values that have settled away from baseline (past
// the two-poll guard, or accepted immediately on a MutationObserver tick), a `lastPoll` snapshot
// for the guard, and the box-model dimension-suppression in `getCurrentChanges`. The split exists
// so a single shared poll + shared MutationObserver in the manager can drive N elements without N
// timers — see watch-manager.ts.
import { SUPPORTED_PROPERTY_LIST, type SupportedProperty } from '@shiage/core/supported'
import type { PropertyChange } from '@shiage/core/protocol'
import { valuesEqual } from './normalize'

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

// Box-model/gap/radius shorthands. `getComputedStyle` resolves every value to its longhands, so a
// shorthand's computed string is just a redundant reflection of them — editing `padding-left` also
// "changes" `padding`. The mapper recombines longhands into shorthand classes itself, so the
// tracker diffs longhands only and skips these to avoid double-counting the same edit.
const SHORTHAND_PROPERTIES: ReadonlySet<string> = new Set([
  'padding',
  'margin',
  'gap',
  'border-width',
  'border-radius',
])

// The properties the tracker actually diffs: every supported one except the shorthands above.
const WATCHED_PROPERTIES = SUPPORTED_PROPERTY_LIST.filter((p) => !SHORTHAND_PROPERTIES.has(p))

export interface ElementTrackerOptions {
  /** Snapshot every supported property's current computed value. Injectable for tests; defaults to
   * a single `getComputedStyle(element)` read per call. */
  readAll?: () => Snapshot
}

export interface ElementTracker {
  readonly element: Element
  /** Read a fresh snapshot, diff against baseline, and update the confirmed set under the right
   * stability rule. `immediate=true` (MutationObserver path) confirms any diff at once;
   * `immediate=false` (poll path) requires the value to also match the previous poll. Returns
   * true if the confirmed set changed in any way (added, updated, or removed), so the caller can
   * fire a single onChange for a batch of trackers. */
  ingest(immediate: boolean): boolean
  /** The confirmed property changes vs. the baseline, ready for the save message. */
  getCurrentChanges(): PropertyChange[]
  /** Re-snapshot the baseline and clear changes (call after a successful apply). Does NOT fire
   * any callback — the caller (manager or wrapper) is responsible for its own onChange. */
  rebaseline(): void
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
      for (const property of WATCHED_PROPERTIES) {
        snap.set(property, cs.getPropertyValue(property))
      }
      return snap
    })

  let baseline = readAll()
  // Confirmed changes: property → current value (differs from baseline, past the stability guard).
  const confirmed = new Map<SupportedProperty, string>()
  // Value seen on the previous poll, for the two-poll stability guard.
  let lastPoll: Snapshot = new Map(baseline)

  function ingest(immediate: boolean): boolean {
    const current = readAll()
    let changed = false
    for (const property of WATCHED_PROPERTIES) {
      const now = current.get(property) ?? ''
      const base = baseline.get(property) ?? ''
      if (!valuesEqual(property, base, now)) {
        const stable = immediate || valuesEqual(property, lastPoll.get(property) ?? '', now)
        if (stable && confirmed.get(property) !== now) {
          confirmed.set(property, now)
          changed = true
        }
      } else if (confirmed.delete(property)) {
        // Reverted to baseline — drop the change.
        changed = true
      }
      lastPoll.set(property, now)
    }
    return changed
  }

  // True when `property` is set directly on the element's own inline style — the signal that the
  // user deliberately edited it in DevTools, as opposed to it being computed/derived.
  function authoredInline(property: string): boolean {
    const style = (element as Partial<ElementCSSInlineStyle>).style
    return !!style && style.getPropertyValue(property) !== ''
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
    rebaseline() {
      baseline = readAll()
      confirmed.clear()
      lastPoll = new Map(baseline)
    },
  }
}
