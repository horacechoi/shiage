// Detects CSS changes the user makes in DevTools on the picked element, against a baseline
// snapshotted at pick time. DevTools edits arrive two ways and need two mechanisms:
//
//   1. Inline edits (editing the element.style box, or toggling a class) mutate the element's
//      `style`/`class` attributes. A MutationObserver catches these instantly. They are applied
//      atomically (not animated), so we accept them immediately.
//
//   2. Stylesheet-rule edits (editing a rule in the Styles pane that matches via a selector) change
//      the element's *computed* style without touching its attributes — the MutationObserver never
//      fires. Only a periodic `getComputedStyle` poll sees them. Because a poll can catch a value
//      mid-CSS-transition, we require the same non-baseline value on two consecutive polls before
//      counting it (the inline path bypasses this guard).
//
// `getCurrentChanges()` returns the confirmed diff for the save message; `rebaseline()` resets after
// a successful apply so the next round of edits diffs against the new source.
import {
  SUPPORTED_PROPERTIES,
  SUPPORTED_PROPERTY_LIST,
  type SupportedProperty,
} from '@shiage/core/supported'
import type { PropertyChange } from '@shiage/core/protocol'
import { valuesEqual } from './normalize'

type Snapshot = Map<SupportedProperty, string>

// Sizing properties whose computed value commonly shifts as a *side effect* of a box-model edit:
// growing padding on an auto-width element widens it, so `getComputedStyle().width` changes without
// the user touching width. We must not write that derived value back as a hardcoded `w-[Npx]` — see
// the suppression in `getCurrentChanges`.
const DIMENSION_PROPERTIES: ReadonlySet<string> = new Set([
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
])

// True for the box-model properties (padding/margin/border-width) whose edits can reflow an
// auto-sized element's dimensions.
const isBoxModelEdit = (property: SupportedProperty): boolean => {
  const group = SUPPORTED_PROPERTIES[property].group
  return group === 'padding' || group === 'margin' || group === 'borderWidth'
}

// Box-model/gap/radius shorthands. `getComputedStyle` resolves every value to its longhands, so a
// shorthand's computed string is just a redundant reflection of them — editing `padding-left` also
// "changes" `padding`. The mapper recombines longhands into shorthand classes itself, so the watcher
// tracks longhands only and skips these to avoid double-counting the same edit.
const SHORTHAND_PROPERTIES: ReadonlySet<string> = new Set([
  'padding',
  'margin',
  'gap',
  'border-width',
  'border-radius',
])

// The properties the watcher actually diffs: every supported one except the shorthands above.
const WATCHED_PROPERTIES = SUPPORTED_PROPERTY_LIST.filter((p) => !SHORTHAND_PROPERTIES.has(p))

export interface WatcherOptions {
  /** Poll interval (ms) for catching stylesheet-rule edits. Default 500. */
  pollMs?: number
  /** Snapshot every supported property's current computed value. Injectable for tests; defaults to
   * a single `getComputedStyle(element)` read per call. */
  readAll?: () => Snapshot
  /** Called whenever the confirmed change set changes (so the overlay can update its count). */
  onChange?: () => void
}

export interface Watcher {
  /** The confirmed property changes vs. the baseline, for the save message. */
  getCurrentChanges(): PropertyChange[]
  /** Re-snapshot the baseline and clear changes (call after a successful apply). */
  rebaseline(): void
  /** Stop observing and polling. */
  stop(): void
}

export function createWatcher(element: Element, options: WatcherOptions = {}): Watcher {
  const pollMs = options.pollMs ?? 500
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

  // Apply a fresh snapshot. `immediate` (MutationObserver path) confirms any diff at once; otherwise
  // (poll path) a diff must match the previous poll's value to be confirmed.
  function ingest(current: Snapshot, immediate: boolean): void {
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
    if (changed) options.onChange?.()
  }

  const observer = new MutationObserver(() => ingest(readAll(), true))
  observer.observe(element, { attributes: true, attributeFilter: ['style', 'class'] })
  const timer = setInterval(() => ingest(readAll(), false), pollMs)

  // True when `property` is set directly on the element's own inline style — the signal that the
  // user deliberately edited it in DevTools, as opposed to it being computed/derived.
  function authoredInline(property: string): boolean {
    const style = (element as Partial<ElementCSSInlineStyle>).style
    return !!style && style.getPropertyValue(property) !== ''
  }

  return {
    getCurrentChanges() {
      // If a box-model property was edited, drop any dimension change that the element didn't
      // explicitly author — it's a reflow side effect (e.g. wider auto-box from more padding), not
      // something to pin into source as `w-[Npx]`. A dimension the user actually set inline survives.
      const boxModelEdited = [...confirmed.keys()].some(isBoxModelEdit)
      const changes: PropertyChange[] = []
      for (const [property, newValue] of confirmed) {
        if (boxModelEdited && DIMENSION_PROPERTIES.has(property) && !authoredInline(property)) {
          continue
        }
        changes.push({ property, oldValue: baseline.get(property) ?? '', newValue })
      }
      return changes
    },
    rebaseline() {
      baseline = readAll()
      confirmed.clear()
      lastPoll = new Map(baseline)
      options.onChange?.()
    },
    stop() {
      observer.disconnect()
      clearInterval(timer)
    },
  }
}
