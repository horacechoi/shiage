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
import { SUPPORTED_PROPERTY_LIST, type SupportedProperty } from '@shiage/core/supported'
import type { PropertyChange } from '@shiage/core/protocol'
import { valuesEqual } from './normalize'

type Snapshot = Map<SupportedProperty, string>

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
      for (const property of SUPPORTED_PROPERTY_LIST) {
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
    for (const property of SUPPORTED_PROPERTY_LIST) {
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

  return {
    getCurrentChanges() {
      const changes: PropertyChange[] = []
      for (const [property, newValue] of confirmed) {
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
