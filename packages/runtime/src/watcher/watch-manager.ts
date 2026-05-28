// The ambient multi-element watch driver. Owns ONE shared `setInterval` poll, ONE document-wide
// attribute `MutationObserver`, and ONE document-wide structural `MutationObserver`, plus a
// `Map<Element, ElementTracker>` registry of every currently-stamped element. The per-element diff
// logic (baseline, stability guard, longhand filtering, box-model dimension suppression) lives in
// element-tracker.ts and is reused unchanged here — this file is purely orchestration.
//
// Two deliberate behavior choices that distinguish ambient mode from the single-element
// `createWatcher` wrapper:
//
//   1. The attribute observer drops `class` from its filter (`attributeFilter: ['style']` only).
//      DevTools edits `style` or stylesheet rules — never `class` directly — so dropping it loses
//      essentially no deliberate signal, while cutting the dominant ambient-noise source: an app
//      className swap (hover/active/route/state) currently fires the *immediate* path and bypasses
//      the two-poll stability guard. A real class-driven computed change still surfaces via the
//      poll path if it settles.
//
//   2. A structural `MutationObserver` (`childList: true, subtree: true`) re-syncs the registry
//      when the DOM changes (HMR, app navigation, conditional renders), so trackers are added for
//      newly-stamped elements and dropped for ones that left the document — without making the
//      single-element wrapper or `mount.ts` aware of any of this.
import type { PropertyChange } from '@shiage/core/protocol'
import { createElementTracker, type ElementTracker } from './element-tracker'

// The stamp the jsx-transform writes on every host element it sees. Tracked elements are exactly
// the ones carrying it — those are the only ones we can rewrite back in source.
const SOURCE_LOC_ATTR = 'data-shiage-loc'

/** One tracked element's contribution to the batch: where its className lives in source, its
 * current className text (the editor merges into this), and the property changes it has accrued.
 * `sourceLoc` is read live from the element on every `getAllChanges` call so an HMR re-stamp is
 * picked up automatically. */
export interface ElementChanges {
  element: Element
  sourceLoc: string
  className: string
  changes: PropertyChange[]
}

export interface WatchManagerOptions {
  /** Poll interval (ms) for catching stylesheet-rule edits. Default 500. */
  pollMs?: number
  /** Document to scan (default `globalThis.document`). Injectable for tests. */
  doc?: Document
  /** Called once whenever the aggregate state changes — a tracker added/removed, a confirmed
   * value flipped on any tracker, or a manual rebaseline. The caller dedupes its own render. */
  onChange?: () => void
  /** Tracker factory (default `createElementTracker`). Injectable for tests so a fake snapshot
   * sequence can drive the manager without happy-dom's computed-style stubs. */
  createTracker?: (el: Element) => ElementTracker
}

export interface WatchManager {
  /** Per-element changes for every tracked element with >=1 change AND a non-null
   * `data-shiage-loc`. Elements without a stamp can't be rewritten in source, so they never
   * contribute to a save; they're still tracked (in case the stamp arrives later via HMR). */
  getAllChanges(): ElementChanges[]
  /** Sum of `getCurrentChanges().length` across every tracker (regardless of sourceLoc), for the
   * pill / aggregate counter. */
  totalChangeCount(): number
  /** Clear `element`'s baseline and confirmed set (call after a successful apply, or as the
   * "reset this element's noise" escape hatch). `rebaseline()` with no argument resets all. */
  rebaseline(element?: Element): void
  /** Re-scan `[data-shiage-loc]` and reconcile the registry. The structural observer already calls
   * this on DOM changes; exposed for tests and for any code that mutates the DOM synchronously
   * (e.g. happy-dom test scaffolding). */
  sync(): void
  /** Disconnect all observers, clear the interval, and drop the registry. */
  stop(): void
}

export function createWatchManager(options: WatchManagerOptions = {}): WatchManager {
  const pollMs = options.pollMs ?? 500
  const doc = options.doc ?? globalThis.document
  const createTracker = options.createTracker ?? createElementTracker
  const trackers = new Map<Element, ElementTracker>()

  // Reconcile registry against the live `[data-shiage-loc]` set. Returns whether membership
  // changed, so the caller can fire onChange just once for a structural batch.
  function rescan(): boolean {
    let changed = false
    const live = new Set<Element>()
    for (const el of doc.querySelectorAll(`[${SOURCE_LOC_ATTR}]`)) {
      live.add(el)
      if (!trackers.has(el)) {
        trackers.set(el, createTracker(el))
        changed = true
      }
    }
    for (const el of [...trackers.keys()]) {
      // `live` membership is enough — an element that left the queried set is gone for our
      // purposes (whether literally removed or just unstamped).
      if (!live.has(el)) {
        trackers.delete(el)
        changed = true
      }
    }
    return changed
  }

  // Initial discovery: silent (no onChange) so a fresh mount doesn't emit a spurious tick.
  rescan()

  // Ingest every tracker, returning whether any of them changed. Disconnected trackers (e.g. an
  // element removed between the structural observer firing and its microtask sync running) are
  // skipped to avoid reading `getComputedStyle` on a detached node and recording spurious deltas.
  function ingestAll(immediate: boolean): boolean {
    let any = false
    for (const tracker of trackers.values()) {
      if (!tracker.element.isConnected) continue
      if (tracker.ingest(immediate)) any = true
    }
    return any
  }

  const timer = setInterval(() => {
    if (ingestAll(false)) options.onChange?.()
  }, pollMs)

  // Attribute observer: DevTools inline edits land here immediately. We ingest every tracker
  // rather than route by target — a future optimization could map `mutation.target → tracker` via
  // `target.closest('[data-shiage-loc]')`, but for now the simpler "ingest all" is correct and
  // cheap (each tracker bails fast when its computed values equal baseline).
  const attrObserver = new MutationObserver(() => {
    if (ingestAll(true)) options.onChange?.()
  })

  // Structural observer: any DOM change can change which elements are stamped. We debounce via a
  // microtask so a burst of insertions (e.g. a full subtree render) triggers exactly one rescan.
  let syncPending = false
  const structuralObserver = new MutationObserver(() => {
    if (syncPending) return
    syncPending = true
    queueMicrotask(() => {
      syncPending = false
      if (rescan()) options.onChange?.()
    })
  })

  // Observe from `documentElement` so the observers are alive even before `<body>` has children,
  // and so a top-level body attribute change wouldn't be missed (unlikely in practice).
  const root = doc.documentElement
  if (root) {
    attrObserver.observe(root, { subtree: true, attributes: true, attributeFilter: ['style'] })
    structuralObserver.observe(root, { subtree: true, childList: true })
  }

  return {
    getAllChanges() {
      const out: ElementChanges[] = []
      for (const [element, tracker] of trackers) {
        const changes = tracker.getCurrentChanges()
        if (changes.length === 0) continue
        const sourceLoc = element.getAttribute(SOURCE_LOC_ATTR)
        if (sourceLoc === null) continue
        out.push({
          element,
          sourceLoc,
          className: element.getAttribute('class') ?? '',
          changes,
        })
      }
      return out
    },
    totalChangeCount() {
      let n = 0
      for (const tracker of trackers.values()) n += tracker.getCurrentChanges().length
      return n
    },
    rebaseline(element) {
      if (element) {
        trackers.get(element)?.rebaseline()
      } else {
        for (const tracker of trackers.values()) tracker.rebaseline()
      }
      options.onChange?.()
    },
    sync() {
      if (rescan()) options.onChange?.()
    },
    stop() {
      clearInterval(timer)
      attrObserver.disconnect()
      structuralObserver.disconnect()
      trackers.clear()
    },
  }
}
