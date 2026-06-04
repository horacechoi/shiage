// Back-compat single-element wrapper around the new tracker + per-instance observer/timer. The
// pure per-element diff logic (baseline, stability guard, longhand filtering, box-model dimension
// suppression) lives in element-tracker.ts; the ambient multi-element driver is watch-manager.ts.
// This file exists so the original `createWatcher(element)` API — used by mount.ts during the
// ambient-tracking transition, and by `watcher.test.ts` as a verbatim pin on the per-element
// logic — keeps working unchanged.
//
// Two mechanisms cover DevTools edits arriving on this one element:
//
//   1. A MutationObserver on `['style', 'class']` of the element. (The shared manager deliberately
//      drops `class` to cut ambient app-driven noise — see watch-manager.ts. The wrapper keeps it
//      for back-compat with tests that assert the single-element behavior.)
//   2. A `pollMs` (default 500) timer running `getComputedStyle` for stylesheet-rule edits the
//      MutationObserver never sees; subject to the tracker's two-poll stability guard.
import type { SupportedProperty } from '@shiage/core/supported'
import type { PropertyChange } from '@shiage/core/protocol'
import { createElementTracker, type AnimatingProperties } from './element-tracker'
import type { ElementProvenance } from '../provenance'

export interface WatcherOptions {
  /** Poll interval (ms) for catching stylesheet-rule edits. Default 500. */
  pollMs?: number
  /** Snapshot every supported property's current computed value. Injectable for tests; defaults
   * to a single `getComputedStyle(element)` read per call. */
  readAll?: () => Map<SupportedProperty, string>
  /** Read+clear the element's programmatic-mutation markers. Injectable for tests. */
  consumeProvenance?: (el: Element) => ElementProvenance
  /** The watched properties currently under an active Web Animation. Injectable for tests. */
  getAnimatingProperties?: () => AnimatingProperties
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
  const tracker = createElementTracker(element, {
    readAll: options.readAll,
    consumeProvenance: options.consumeProvenance,
    getAnimatingProperties: options.getAnimatingProperties,
  })

  const observer = new MutationObserver(() => {
    if (tracker.ingest(true)) options.onChange?.()
  })
  observer.observe(element, { attributes: true, attributeFilter: ['style', 'class'] })
  const timer = setInterval(() => {
    if (tracker.ingest(false)) options.onChange?.()
  }, pollMs)

  return {
    getCurrentChanges() {
      return tracker.getCurrentChanges()
    },
    rebaseline() {
      tracker.rebaseline()
      options.onChange?.()
    },
    stop() {
      observer.disconnect()
      clearInterval(timer)
    },
  }
}
