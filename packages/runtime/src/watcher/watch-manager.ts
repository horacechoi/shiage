// The ambient multi-element watch driver. Owns ONE shared `setInterval` poll, ONE document-wide
// attribute `MutationObserver`, ONE document-wide structural `MutationObserver`, and ONE
// document-wide set of CSS animation/transition listeners, plus a `Map<Element, ElementTracker>`
// registry of every currently-stamped element. The per-element diff logic (baseline, stability
// guard, provenance absorption, animation taint, box-model dimension suppression) lives in
// element-tracker.ts and is reused unchanged here — this file is purely orchestration.
//
// Deliberate behavior choices that distinguish ambient mode from the single-element `createWatcher`
// wrapper:
//
//   1. The attribute observer drops `class` from its filter (`attributeFilter: ['style']` only).
//      DevTools edits `style` or stylesheet rules — never `class` directly — so dropping it loses
//      essentially no deliberate signal, while cutting the dominant ambient-noise source: an app
//      className swap (hover/active/route/state) currently fires the *immediate* path and bypasses
//      the two-poll stability guard. A real class-driven computed change still surfaces via the
//      poll path if it settles (and is now absorbed if it carries provenance — see element-tracker).
//
//   2. A structural `MutationObserver` (`childList: true, subtree: true`) re-syncs the registry
//      when the DOM changes (HMR, app navigation, conditional renders).
//
//   3. CSS transition/animation events (captured at the document) taint the originating tracked
//      element so an in-flight animation's frames are never recorded; when an element's animations
//      end, its settled values are absorbed into the baseline rather than reported.
import type { PropertyChange } from '@shiage/core/protocol'
import { watchedPropertyFor, type SupportedProperty } from '@shiage/core/supported'
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

/** Handler the animation-event subscriber drives on transition/animation START. `property` is a
 * specific watched property for transitions, or `'all'` for keyframe animations (whose properties
 * aren't on the event). End/cancel are not needed — the tracker's `getAnimations()` probe is the
 * authority on when an animation has stopped. */
export interface AnimationEventHandlers {
  onStart(target: EventTarget | null, property: SupportedProperty | 'all'): void
}

/** Subscribe to CSS transition/animation lifecycle; returns an unsubscribe fn. Injectable so tests
 * can drive the handlers deterministically (happy-dom does not dispatch these events). */
export type AnimationEventsSubscriber = (
  handlers: AnimationEventHandlers,
  doc: Document,
) => () => void

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
  /** Delay (ms) before re-baselining a freshly-added tracker, to absorb the layout-settling and
   * stylesheet-load deltas that show up if the tracker is created while the page is still
   * rendering. Skipped if the tracker already has confirmed changes by then. Default 0 (off) for
   * unit-test determinism; mount.ts opts in with ~32ms (~2 frames). */
  settleMs?: number
  /** Debounce (ms) for the attribute-observer "immediate" ingest, so a frame-by-frame inline-style
   * animation collapses into one ingest instead of N. Default 0 (synchronous) for test
   * determinism; mount.ts opts in with ~32ms. */
  immediateDebounceMs?: number
  /** Subscribe to CSS transition/animation start events (default: capturing document listeners).
   * Injectable for tests. */
  animationEvents?: AnimationEventsSubscriber
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
   * this on DOM changes; exposed for tests and for any code that mutates the DOM synchronously. */
  sync(): void
  /** Disconnect all observers, clear timers, remove animation listeners, and drop the registry. */
  stop(): void
}

// Default subscriber: capturing document listeners. Transitions carry the exact `propertyName`
// (forwarded only when it's a watched property); keyframe animations don't, so they taint `'all'`.
const defaultAnimationEvents: AnimationEventsSubscriber = (handlers, doc) => {
  const onTransitionStart = (e: Event): void => {
    // Transitions fire per-longhand (e.g. `border-top-color`); map to the watched property.
    const watched = watchedPropertyFor((e as TransitionEvent).propertyName)
    if (watched) handlers.onStart(e.target, watched)
  }
  const onAnimationStart = (e: Event): void => handlers.onStart(e.target, 'all')
  // `transitionrun` fires at creation (before any delay) for the earliest possible taint. We only
  // need the START — the tracker's `getAnimations()` probe detects when each animation has stopped.
  doc.addEventListener('transitionrun', onTransitionStart, true)
  doc.addEventListener('animationstart', onAnimationStart, true)
  return () => {
    doc.removeEventListener('transitionrun', onTransitionStart, true)
    doc.removeEventListener('animationstart', onAnimationStart, true)
  }
}

export function createWatchManager(options: WatchManagerOptions = {}): WatchManager {
  const pollMs = options.pollMs ?? 500
  const settleMs = options.settleMs ?? 0
  const immediateDebounceMs = options.immediateDebounceMs ?? 0
  const doc = options.doc ?? globalThis.document
  const createTracker = options.createTracker ?? createElementTracker
  const trackers = new Map<Element, ElementTracker>()

  // The attribute observer's debounced "immediate" ingest. Defined up here so `scheduleSettle` can
  // flush a pending one before deciding whether to rebaseline (see below).
  let immediateTimer: ReturnType<typeof setTimeout> | null = null
  function fireImmediate(): void {
    immediateTimer = null
    if (ingestAll(true)) options.onChange?.()
  }
  function flushImmediate(): void {
    if (immediateTimer === null) return
    clearTimeout(immediateTimer)
    fireImmediate()
  }

  function scheduleSettle(tracker: ElementTracker): void {
    if (settleMs <= 0) return
    setTimeout(() => {
      if (!tracker.element.isConnected) return
      // A user inline edit in the settle window lands on the (debounced) immediate path; flush it
      // first so we don't rebaseline the edit away. Layout-settling deltas come via the poll path,
      // so they stay unconfirmed here and are correctly absorbed by the rebaseline.
      flushImmediate()
      if (tracker.getCurrentChanges().length === 0) tracker.rebaseline()
    }, settleMs)
  }

  function rescan(): boolean {
    let changed = false
    const live = new Set<Element>()
    for (const el of doc.querySelectorAll(`[${SOURCE_LOC_ATTR}]`)) {
      live.add(el)
      if (!trackers.has(el)) {
        const tracker = createTracker(el)
        trackers.set(el, tracker)
        scheduleSettle(tracker)
        changed = true
      }
    }
    for (const el of [...trackers.keys()]) {
      if (!live.has(el)) {
        trackers.delete(el)
        changed = true
      }
    }
    return changed
  }

  // Initial discovery: silent (no onChange) so a fresh mount doesn't emit a spurious tick.
  rescan()

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

  // Attribute observer: DevTools inline edits land here. The debounce (see `fireImmediate` above)
  // collapses a frame-by-frame inline-style animation (which the provenance layer absorbs anyway)
  // into a single ingest.
  const onAttrMutation =
    immediateDebounceMs <= 0
      ? fireImmediate
      : (): void => {
          if (immediateTimer !== null) return
          immediateTimer = setTimeout(fireImmediate, immediateDebounceMs)
        }
  const attrObserver = new MutationObserver(onAttrMutation)

  // Structural observer: any DOM change can change which elements are stamped. Debounced via a
  // microtask so a burst of insertions triggers exactly one rescan.
  let syncPending = false
  const structuralObserver = new MutationObserver(() => {
    if (syncPending) return
    syncPending = true
    queueMicrotask(() => {
      syncPending = false
      if (rescan()) options.onChange?.()
    })
  })

  // ── Animation events ──
  // On a transition/animation START, taint the originating tracked element's property (resolving an
  // event on a child to its stamped ancestor). That's all the events do: the tracker's
  // `getAnimations()` probe is the authority on when the animation stops (and then absorbs the
  // settled value), so no end/cancel handling or ref-counting is needed here — which keeps this
  // robust to the rapid, overlapping, variable-driven transitions real pages produce.
  const animTeardown = (options.animationEvents ?? defaultAnimationEvents)(
    {
      onStart(target, property) {
        if (!(target instanceof Element)) return
        const stamped = target.closest(`[${SOURCE_LOC_ATTR}]`)
        const tracker = stamped ? trackers.get(stamped) : undefined
        if (!tracker) return
        if (tracker.taint(property)) options.onChange?.()
      },
    },
    doc,
  )

  // Observe from `documentElement` so the observers are alive even before `<body>` has children.
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
      if (immediateTimer !== null) clearTimeout(immediateTimer)
      animTeardown()
      attrObserver.disconnect()
      structuralObserver.disconnect()
      trackers.clear()
    },
  }
}
