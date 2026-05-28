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
    const tracker = createElementTracker(
      document.createElement('div'),
      fromSnapshots([snap({})]),
    )
    expect(() => tracker.rebaseline()).not.toThrow()
  })
})
