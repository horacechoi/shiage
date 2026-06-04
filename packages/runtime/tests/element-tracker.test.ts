// @vitest-environment happy-dom
// Pin the pure per-element diff logic in isolation — no timers, no observers, just direct
// `ingest(immediate)` calls against injected snapshot sequences. watcher.test.ts already covers
// the same logic through the wrapper (with timers and MutationObserver); these tests prove the
// behavior holds at the unit boundary, which is what the watch-manager.ts orchestration calls.
import { describe, it, expect, afterEach } from 'vitest'
import { createElementTracker } from '../src/watcher/element-tracker'
import type { SupportedProperty } from '@shiage/core/supported'

// A partial computed snapshot; unlisted properties read as '' (matching happy-dom's bare defaults).
const snap = (values: Record<string, string>): Map<SupportedProperty, string> =>
  new Map(Object.entries(values)) as Map<SupportedProperty, string>

// Drive ingest from a fixed sequence of snapshots; the tracker reads index 0 on construction
// (baseline), then index 1 on the first ingest, etc., clamping to the last entry.
function fromSnapshots(snapshots: Map<SupportedProperty, string>[]): {
  readAll: () => Map<SupportedProperty, string>
} {
  let i = 0
  return { readAll: () => snapshots[Math.min(i++, snapshots.length - 1)]! }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('createElementTracker — ingest contract', () => {
  it('returns true when a change is confirmed and false on a subsequent no-op ingest', () => {
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([snap({ 'padding-left': '16px' }), snap({ 'padding-left': '24px' })]),
    )

    expect(tracker.ingest(true)).toBe(true) // 24px ≠ baseline 16px, immediate → confirmed
    expect(tracker.ingest(true)).toBe(false) // value unchanged on the next read → no-op
    expect(tracker.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ])
  })

  it('returns true again when a previously-confirmed property reverts to baseline', () => {
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([
        snap({ 'padding-left': '16px' }), // baseline
        snap({ 'padding-left': '24px' }), // confirm
        snap({ 'padding-left': '16px' }), // revert — confirmed entry should be dropped
      ]),
    )
    expect(tracker.ingest(true)).toBe(true)
    expect(tracker.ingest(true)).toBe(true) // dropping the confirmed entry counts as "changed"
    expect(tracker.getCurrentChanges()).toEqual([])
  })

  it('reports nothing when every read equals the baseline', () => {
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([snap({ 'padding-left': '16px' }), snap({ 'padding-left': '16px' })]),
    )
    expect(tracker.ingest(true)).toBe(false)
    expect(tracker.ingest(false)).toBe(false)
    expect(tracker.getCurrentChanges()).toEqual([])
  })

  it('confirms many properties at once when several differ in a single read', () => {
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([
        snap({ 'padding-left': '16px', 'margin-top': '8px' }),
        snap({ 'padding-left': '24px', 'margin-top': '0px' }),
      ]),
    )
    expect(tracker.ingest(true)).toBe(true)
    const changes = tracker.getCurrentChanges()
    expect(changes).toHaveLength(2)
    expect(changes).toContainEqual({ property: 'padding-left', oldValue: '16px', newValue: '24px' })
    expect(changes).toContainEqual({ property: 'margin-top', oldValue: '8px', newValue: '0px' })
  })

  it('exposes the element it was created for', () => {
    const el = document.createElement('div')
    const tracker = createElementTracker(el, fromSnapshots([snap({})]))
    expect(tracker.element).toBe(el)
  })
})

describe('createElementTracker — two-poll stability guard', () => {
  it('rejects a single poll difference and confirms only when two consecutive polls agree', () => {
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([
        snap({ 'padding-left': '16px' }), // baseline
        snap({ 'padding-left': '20px' }), // poll 1 (mid-transition)
        snap({ 'padding-left': '24px' }), // poll 2 (still moving — differs from poll 1)
        snap({ 'padding-left': '24px' }), // poll 3 (settled — matches poll 2)
      ]),
    )
    expect(tracker.ingest(false)).toBe(false) // unstable vs baseline-as-lastPoll
    expect(tracker.ingest(false)).toBe(false) // unstable vs the 20px lastPoll
    expect(tracker.ingest(false)).toBe(true) // 24px matches the 24px lastPoll → confirmed
    expect(tracker.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ])
  })

  it('skips the stability guard on the immediate path (MutationObserver tick)', () => {
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([snap({ 'padding-left': '16px' }), snap({ 'padding-left': '24px' })]),
    )
    // Even though there is no "previous poll" matching this value, immediate=true accepts it.
    expect(tracker.ingest(true)).toBe(true)
  })

  it('ignores sub-pixel computed noise (23.999px vs 24px) on the poll path', () => {
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([
        snap({ 'padding-left': '24px' }),
        snap({ 'padding-left': '23.999px' }),
        snap({ 'padding-left': '23.999px' }),
      ]),
    )
    expect(tracker.ingest(false)).toBe(false)
    expect(tracker.ingest(false)).toBe(false) // within LENGTH_EPSILON_PX of baseline
    expect(tracker.getCurrentChanges()).toEqual([])
  })
})

describe('createElementTracker — redundant-reflection filtering', () => {
  it('ignores a box-model shorthand that just reflects a longhand edit', () => {
    // `padding` is a shorthand — WATCHED_PROPERTIES excludes it, so its computed string changing
    // alongside `padding-left` does NOT produce a second change entry.
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([
        snap({ 'padding-left': '16px', padding: '8px 16px' }),
        snap({ 'padding-left': '24px', padding: '8px 16px 8px 24px' }),
      ]),
    )
    expect(tracker.ingest(true)).toBe(true)
    expect(tracker.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ])
  })

  it('suppresses a width change reflowed by a padding edit when width is not authored inline', () => {
    // An auto-width element: editing padding-left widens it, so width changes too — but the user
    // only touched padding, so the derived width must not appear as its own change entry.
    const el = document.createElement('div')
    document.body.appendChild(el)
    const tracker = createElementTracker(
      el,
      fromSnapshots([
        snap({ 'padding-left': '16px', width: '100px' }),
        snap({ 'padding-left': '24px', width: '108px' }),
      ]),
    )
    expect(tracker.ingest(true)).toBe(true)
    expect(tracker.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ])
  })

  it('keeps a width change that was authored inline alongside the padding edit', () => {
    // The user explicitly set `width` on the element's own inline style — `authoredInline` is true
    // for it, so the suppression carves it back out as a deliberate edit.
    const el = document.createElement('div')
    el.style.width = '120px'
    document.body.appendChild(el)
    const tracker = createElementTracker(
      el,
      fromSnapshots([
        snap({ 'padding-left': '16px', width: '100px' }),
        snap({ 'padding-left': '24px', width: '120px' }),
      ]),
    )
    expect(tracker.ingest(true)).toBe(true)
    const changes = tracker.getCurrentChanges()
    expect(changes).toContainEqual({ property: 'padding-left', oldValue: '16px', newValue: '24px' })
    expect(changes).toContainEqual({ property: 'width', oldValue: '100px', newValue: '120px' })
  })

  it('drops a width change that is not authored inline, even with no box-model edit', () => {
    // The DevTools-docking case: a stylesheet rule resolved smaller (e.g. `min-h-screen` →
    // `100dvh` shrinking) cascades into a width/height delta on a stamped element that the user
    // never touched inline. We must not pin that into source as `w-[Npx]`. Inline authorship is
    // the only deliberate-edit signal we can trust.
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([snap({ width: '100px' }), snap({ width: '120px' })]),
    )
    expect(tracker.ingest(true)).toBe(true)
    expect(tracker.getCurrentChanges()).toEqual([])
  })

  it('keeps a width change when the user authored it inline (DevTools element.style box)', () => {
    // The deliberate-edit path: the user types `width: 120px` into the `element.style {}` block in
    // DevTools, which mutates the inline `style` attribute. `authoredInline` is true → kept.
    const el = document.createElement('div')
    el.style.width = '120px'
    document.body.appendChild(el)
    const tracker = createElementTracker(
      el,
      fromSnapshots([snap({ width: '100px' }), snap({ width: '120px' })]),
    )
    expect(tracker.ingest(true)).toBe(true)
    expect(tracker.getCurrentChanges()).toEqual([
      { property: 'width', oldValue: '100px', newValue: '120px' },
    ])
  })
})

describe('createElementTracker — rebaseline', () => {
  it('clears confirmed changes and re-diffs against the new snapshot', () => {
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([
        snap({ 'padding-left': '16px' }), // baseline
        snap({ 'padding-left': '24px' }), // first edit
        snap({ 'padding-left': '24px' }), // rebaseline read (this becomes the new baseline)
        snap({ 'padding-left': '32px' }), // second edit, diffed against the new baseline
      ]),
    )
    expect(tracker.ingest(true)).toBe(true)
    expect(tracker.getCurrentChanges()).toHaveLength(1)

    tracker.rebaseline() // consumes snapshot index 2 → baseline now 24px
    expect(tracker.getCurrentChanges()).toEqual([])

    expect(tracker.ingest(true)).toBe(true)
    expect(tracker.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '24px', newValue: '32px' },
    ])
  })

  it('does not fire any callback — the caller owns onChange notification', () => {
    // No onChange option exists on the tracker by design (the manager / wrapper batches it). This
    // test just documents that contract via the type-level absence and a smoke call.
    const tracker = createElementTracker(document.createElement('div'), fromSnapshots([snap({})]))
    expect(() => tracker.rebaseline()).not.toThrow()
  })
})

// A `consumeProvenance` that reports markers on its first call, then nothing — matching the real
// consume-once store.
const onceProvenance = (prov: { props: Set<SupportedProperty>; broad: boolean }) => {
  let used = false
  return () => {
    if (used) return { props: new Set<SupportedProperty>(), broad: false }
    used = true
    return prov
  }
}
const noProvenance = () => ({ props: new Set<SupportedProperty>(), broad: false })
const notAnimating = () => new Set<SupportedProperty>()

describe('createElementTracker — provenance (origin instrumentation)', () => {
  it('absorbs a programmatic inline write instead of confirming it', () => {
    const tracker = createElementTracker(document.createElement('div'), {
      ...fromSnapshots([snap({ opacity: '0' }), snap({ opacity: '1' }), snap({ opacity: '1' })]),
      consumeProvenance: onceProvenance({ props: new Set(['opacity']), broad: false }),
      getAnimatingProperties: notAnimating,
    })
    // opacity 0→1 but it carries a style-write marker → absorbed into the baseline, not recorded.
    expect(tracker.ingest(true)).toBe(false)
    expect(tracker.getCurrentChanges()).toEqual([])
    // And it does not resurface on a later poll once the marker is gone.
    expect(tracker.ingest(false)).toBe(false)
    expect(tracker.getCurrentChanges()).toEqual([])
  })

  it('no provenance → a divergence is confirmed as a DevTools edit (control)', () => {
    const tracker = createElementTracker(document.createElement('div'), {
      ...fromSnapshots([snap({ opacity: '0' }), snap({ opacity: '1' })]),
      consumeProvenance: noProvenance,
      getAnimatingProperties: notAnimating,
    })
    expect(tracker.ingest(true)).toBe(true)
    expect(tracker.getCurrentChanges()).toEqual([
      { property: 'opacity', oldValue: '0', newValue: '1' },
    ])
  })

  it('a broad class/attr marker absorbs a non-inline change but preserves a DevTools inline edit', () => {
    const el = document.createElement('div')
    el.style.paddingLeft = '24px' // authored inline (the deliberate-edit signal); install not run → no style marker
    document.body.appendChild(el)
    const tracker = createElementTracker(el, {
      ...fromSnapshots([
        snap({ 'padding-left': '16px', opacity: '0' }),
        snap({ 'padding-left': '24px', opacity: '1' }),
      ]),
      consumeProvenance: onceProvenance({ props: new Set(), broad: true }),
      getAnimatingProperties: notAnimating,
    })
    tracker.ingest(true)
    // padding-left is authored inline with no style marker → a real edit (kept); the class-driven
    // opacity change is absorbed.
    expect(tracker.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ])
  })

  it('a broad marker absorbs an inline var() property (app-driven, not a protected edit)', () => {
    // An element whose inline `opacity` is a `var()` expression (e.g. `opacity: var(--o)`), animated
    // by a custom-property write (which marks broad). The var() value is app-driven, so it must NOT
    // be treated as a protected DevTools edit — the opacity change is absorbed, not recorded.
    const el = document.createElement('div')
    el.style.setProperty('opacity', 'var(--o, 1)')
    document.body.appendChild(el)
    const tracker = createElementTracker(el, {
      ...fromSnapshots([snap({ opacity: '0.2' }), snap({ opacity: '0.9' })]),
      consumeProvenance: onceProvenance({ props: new Set(), broad: true }),
      getAnimatingProperties: notAnimating,
    })
    tracker.ingest(true)
    expect(tracker.getCurrentChanges()).toEqual([])
  })
})

describe('createElementTracker — animation awareness', () => {
  it('does not confirm a property under an active animation (probe veto)', () => {
    let animating = true
    const tracker = createElementTracker(document.createElement('div'), {
      ...fromSnapshots([snap({ opacity: '0' }), snap({ opacity: '1' }), snap({ opacity: '1' })]),
      consumeProvenance: noProvenance,
      getAnimatingProperties: () =>
        animating ? new Set<SupportedProperty>(['opacity']) : new Set(),
    })
    expect(tracker.ingest(true)).toBe(false) // animating → absorbed
    expect(tracker.getCurrentChanges()).toEqual([])
    animating = false
    tracker.ingest(false)
    expect(tracker.getCurrentChanges()).toEqual([])
  })

  it('absorbs the value while the probe reports animating, so the settled value is never recorded', () => {
    // getAnimations() reports a transition until its end time, by which point the value is final —
    // so the last absorb (while still "animating") captures the settled value; once the probe goes
    // empty there is no divergence to confirm.
    let animating = true
    const tracker = createElementTracker(document.createElement('div'), {
      ...fromSnapshots([
        snap({ opacity: '0' }), // baseline
        snap({ opacity: '0.3' }), // mid-animation (absorbed)
        snap({ opacity: '1' }), // final value, probe still reports animating → absorbed
        snap({ opacity: '1' }),
      ]),
      consumeProvenance: noProvenance,
      getAnimatingProperties: () =>
        animating ? new Set<SupportedProperty>(['opacity']) : new Set(),
    })
    tracker.ingest(true) // 0.3 absorbed
    tracker.ingest(true) // 1 absorbed (still animating)
    animating = false
    tracker.ingest(false) // probe empty, value == baseline (1) → nothing
    expect(tracker.getCurrentChanges()).toEqual([])
  })

  it('taint(property) blocks confirmation and drops an already-confirmed change', () => {
    const tracker = createElementTracker(document.createElement('div'), {
      ...fromSnapshots([snap({ opacity: '0' }), snap({ opacity: '1' }), snap({ opacity: '1' })]),
      consumeProvenance: noProvenance,
      getAnimatingProperties: notAnimating,
    })
    expect(tracker.ingest(true)).toBe(true)
    expect(tracker.getCurrentChanges()).toHaveLength(1)
    expect(tracker.taint('opacity')).toBe(true) // dropped the confirmed entry
    expect(tracker.getCurrentChanges()).toEqual([])
    // While tainted, a re-read of the same value is not re-confirmed.
    expect(tracker.ingest(true)).toBe(false)
    expect(tracker.getCurrentChanges()).toEqual([])
  })

  it('taint("all") blocks every property until the probe reports the element stopped', () => {
    let animating = true
    const tracker = createElementTracker(document.createElement('div'), {
      ...fromSnapshots([
        snap({ opacity: '0' }), // baseline
        snap({ opacity: '1' }), // absorbed (taintedAll + probe 'all')
        snap({ opacity: '1' }), // probe goes empty → taint clears, 1 becomes the baseline
        snap({ opacity: '0.5' }), // a genuine later edit
      ]),
      consumeProvenance: noProvenance,
      getAnimatingProperties: () => (animating ? 'all' : new Set<SupportedProperty>()),
    })
    tracker.taint('all')
    expect(tracker.hasTaint()).toBe(true)
    tracker.ingest(true) // opacity 0→1 absorbed; probe still 'all' → taint persists
    expect(tracker.getCurrentChanges()).toEqual([])
    expect(tracker.hasTaint()).toBe(true)
    animating = false
    tracker.ingest(true) // probe empty → taintedAll cleared
    expect(tracker.hasTaint()).toBe(false)
    tracker.ingest(true) // a fresh divergence now confirms as a real edit
    expect(tracker.getCurrentChanges()).toEqual([
      { property: 'opacity', oldValue: '1', newValue: '0.5' },
    ])
  })

  it('a tainted property absorbs its settled value once the probe reports it stopped (no ingest during the transition)', () => {
    // The CSS-variable-driven transition case: a short transition taints the property and ends
    // before any poll lands. The event-seeded taint persists until the probe clears it, so the
    // first ingest after it stops absorbs the settled value instead of confirming a phantom.
    let animating = true
    const tracker = createElementTracker(document.createElement('div'), {
      ...fromSnapshots([
        snap({ 'background-color': 'rgb(0, 0, 0)' }), // baseline (sampled mid-cycle, "active")
        snap({ 'background-color': 'rgb(255, 255, 255)' }), // settled "idle" value
        snap({ 'background-color': 'rgb(255, 255, 255)' }),
      ]),
      consumeProvenance: noProvenance,
      getAnimatingProperties: () =>
        animating ? new Set<SupportedProperty>(['background-color']) : new Set(),
    })
    tracker.taint('background-color') // transitionrun — no ingest runs during the transition
    animating = false // transition ended; probe now reports stopped
    tracker.ingest(false) // tainted → absorb the settled value, then un-taint
    expect(tracker.getCurrentChanges()).toEqual([])
    tracker.ingest(false) // no resurface
    expect(tracker.getCurrentChanges()).toEqual([])
  })
})
