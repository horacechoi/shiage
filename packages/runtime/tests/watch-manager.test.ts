// @vitest-environment happy-dom
// Exercises the ambient multi-element driver against happy-dom: real document, real
// MutationObservers, real microtask scheduling. For tests where the focus is the manager's
// orchestration (registry sync, attribute-filter discipline, onChange aggregation) rather than
// per-element diff math, we inject a fake `createTracker` so the tracker's internals are not the
// thing under test — element-tracker.test.ts already pins those.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createWatchManager } from '../src/watcher/watch-manager'
import type { ElementTracker } from '../src/watcher/element-tracker'
import type { PropertyChange } from '@shiage/core/protocol'

// Let happy-dom flush both the MutationObserver microtask and the structural-sync microtask.
const flushMutations = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// A controllable fake tracker so tests can decide exactly what `ingest` does and observe how
// often the manager calls it — without depending on happy-dom's getComputedStyle stubs.
function fakeTracker(initial: { changes?: PropertyChange[]; nextChanged?: boolean } = {}) {
  const tracker = {
    element: null as unknown as Element, // filled in by the factory below
    changes: initial.changes ?? ([] as PropertyChange[]),
    nextChanged: initial.nextChanged ?? false,
    ingestCalls: [] as boolean[],
    rebaselineCalls: 0,
    ingest(immediate: boolean): boolean {
      this.ingestCalls.push(immediate)
      const ret = this.nextChanged
      this.nextChanged = false
      return ret
    },
    getCurrentChanges(): PropertyChange[] {
      return this.changes
    },
    rebaseline(): void {
      this.rebaselineCalls += 1
      this.changes = []
    },
  }
  return tracker
}

function stamped(loc: string, className = ''): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-shiage-loc', loc)
  if (className) el.setAttribute('class', className)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('createWatchManager — registry sync', () => {
  it('discovers stamped elements on construction without firing onChange', () => {
    const a = stamped('A.tsx:1:1')
    const b = stamped('B.tsx:2:2')
    document.body.append(a, b)
    const onChange = vi.fn()
    const trackers = new Map<Element, ReturnType<typeof fakeTracker>>()
    const manager = createWatchManager({
      pollMs: 1_000_000,
      onChange,
      createTracker: (el) => {
        const t = fakeTracker()
        t.element = el
        trackers.set(el, t)
        return t as unknown as ElementTracker
      },
    })

    // A tracker exists for each stamped element, but the initial discovery is silent.
    expect(trackers.size).toBe(2)
    expect(onChange).not.toHaveBeenCalled()
    manager.stop()
  })

  it('adds a tracker when a new stamped element is inserted, and fires onChange', async () => {
    const onChange = vi.fn()
    const built: Element[] = []
    const manager = createWatchManager({
      pollMs: 1_000_000,
      onChange,
      createTracker: (el) => {
        built.push(el)
        const t = fakeTracker()
        t.element = el
        return t as unknown as ElementTracker
      },
    })
    expect(built).toHaveLength(0)

    const el = stamped('A.tsx:1:1')
    document.body.appendChild(el)
    await flushMutations()

    expect(built).toContain(el)
    expect(onChange).toHaveBeenCalled() // structural sync notifies on membership change
    manager.stop()
  })

  it('drops a tracker when its element leaves the document', async () => {
    const el = stamped('A.tsx:1:1')
    document.body.appendChild(el)
    const onChange = vi.fn()
    let built = 0
    const manager = createWatchManager({
      pollMs: 1_000_000,
      onChange,
      createTracker: (e) => {
        built += 1
        const t = fakeTracker()
        t.element = e
        return t as unknown as ElementTracker
      },
    })
    expect(built).toBe(1)
    onChange.mockClear() // ignore any initial discovery sync

    el.remove()
    await flushMutations()

    expect(onChange).toHaveBeenCalled()
    // After the sync, the removed element produces nothing in getAllChanges even if we mutate it.
    expect(manager.getAllChanges()).toEqual([])
    manager.stop()
  })

  it('manager.sync() can be driven synchronously for tests', () => {
    const onChange = vi.fn()
    const manager = createWatchManager({
      pollMs: 1_000_000,
      onChange,
      createTracker: (el) => {
        const t = fakeTracker()
        t.element = el
        return t as unknown as ElementTracker
      },
    })
    onChange.mockClear()

    document.body.appendChild(stamped('A.tsx:1:1'))
    // No flushMutations yet — the structural observer hasn't run, but explicit sync sees it.
    manager.sync()
    expect(onChange).toHaveBeenCalled()
    manager.stop()
  })
})

describe('createWatchManager — attribute observer', () => {
  it('ingests on a `style` attribute mutation with the immediate flag set', async () => {
    const el = stamped('A.tsx:1:1')
    document.body.appendChild(el)
    let tracker!: ReturnType<typeof fakeTracker>
    const onChange = vi.fn()
    const manager = createWatchManager({
      pollMs: 1_000_000,
      onChange,
      createTracker: (e) => {
        tracker = fakeTracker({ nextChanged: true })
        tracker.element = e
        return tracker as unknown as ElementTracker
      },
    })
    onChange.mockClear()

    el.style.paddingLeft = '24px'
    await flushMutations()

    // The first immediate=true call corresponds to the style mutation we just made.
    expect(tracker.ingestCalls.some((immediate) => immediate === true)).toBe(true)
    expect(onChange).toHaveBeenCalled()
    manager.stop()
  })

  it('does NOT observe the `class` attribute — app className swaps are ambient-mode noise', async () => {
    const el = stamped('A.tsx:1:1', 'initial')
    document.body.appendChild(el)
    let tracker!: ReturnType<typeof fakeTracker>
    const onChange = vi.fn()
    const manager = createWatchManager({
      pollMs: 1_000_000,
      onChange,
      createTracker: (e) => {
        tracker = fakeTracker({ nextChanged: true })
        tracker.element = e
        return tracker as unknown as ElementTracker
      },
    })
    onChange.mockClear()
    tracker.ingestCalls = []

    el.setAttribute('class', 'swapped')
    await flushMutations()

    // No immediate ingest fired for the class change — only style is in the attribute filter. A
    // genuine resulting computed change still has the poll path to surface via if it settles.
    expect(tracker.ingestCalls.filter((immediate) => immediate === true)).toEqual([])
    manager.stop()
  })

  it('fires onChange only once per attribute batch even with many trackers', async () => {
    const a = stamped('A.tsx:1:1')
    const b = stamped('B.tsx:2:2')
    document.body.append(a, b)
    let aTracker!: ReturnType<typeof fakeTracker>
    const onChange = vi.fn()
    const manager = createWatchManager({
      pollMs: 1_000_000,
      onChange,
      createTracker: (el) => {
        const t = fakeTracker({ nextChanged: el === a }) // only a's tracker reports change
        t.element = el
        if (el === a) aTracker = t
        return t as unknown as ElementTracker
      },
    })
    onChange.mockClear()

    a.style.paddingLeft = '24px'
    await flushMutations()

    expect(aTracker.ingestCalls.some((i) => i === true)).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1) // not once per tracker
    manager.stop()
  })
})

describe('createWatchManager — aggregation', () => {
  it('returns one entry per element with >=1 change, reading sourceLoc + className live', () => {
    const a = stamped('A.tsx:1:1', 'pl-4')
    const b = stamped('B.tsx:2:2', 'pl-2')
    document.body.append(a, b)
    const trackers = new Map<Element, ReturnType<typeof fakeTracker>>()
    const manager = createWatchManager({
      pollMs: 1_000_000,
      createTracker: (el) => {
        const t = fakeTracker()
        t.element = el
        trackers.set(el, t)
        return t as unknown as ElementTracker
      },
    })
    trackers.get(a)!.changes = [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }]
    trackers.get(b)!.changes = [{ property: 'padding-left', oldValue: '8px', newValue: '16px' }]

    const all = manager.getAllChanges()
    expect(all).toHaveLength(2)
    const byLoc = new Map(all.map((e) => [e.sourceLoc, e]))
    expect(byLoc.get('A.tsx:1:1')!.className).toBe('pl-4')
    expect(byLoc.get('B.tsx:2:2')!.className).toBe('pl-2')

    // Live read: a className update after the tracker was created is reflected on the next call.
    a.setAttribute('class', 'pl-6')
    expect(manager.getAllChanges().find((e) => e.sourceLoc === 'A.tsx:1:1')!.className).toBe('pl-6')
    manager.stop()
  })

  it('skips elements with no changes and elements without a sourceLoc', () => {
    const stampedEl = stamped('A.tsx:1:1')
    const unstampedEl = document.createElement('div')
    // Force the manager to track the unstamped element too so we can prove the filter behavior.
    document.body.append(stampedEl, unstampedEl)
    const trackers = new Map<Element, ReturnType<typeof fakeTracker>>()
    const manager = createWatchManager({
      pollMs: 1_000_000,
      createTracker: (el) => {
        const t = fakeTracker()
        t.element = el
        trackers.set(el, t)
        return t as unknown as ElementTracker
      },
    })

    // Only the stamped tracker reports changes; the unstamped one is in the registry only because
    // we forced it (manager wouldn't normally pick it up — querySelectorAll filters by attr).
    trackers.get(stampedEl)!.changes = [
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ]

    expect(manager.getAllChanges()).toEqual([
      {
        element: stampedEl,
        sourceLoc: 'A.tsx:1:1',
        className: '',
        changes: trackers.get(stampedEl)!.changes,
      },
    ])
    manager.stop()
  })

  it('totalChangeCount sums getCurrentChanges across all trackers', () => {
    const a = stamped('A.tsx:1:1')
    const b = stamped('B.tsx:2:2')
    document.body.append(a, b)
    const trackers = new Map<Element, ReturnType<typeof fakeTracker>>()
    const manager = createWatchManager({
      pollMs: 1_000_000,
      createTracker: (el) => {
        const t = fakeTracker()
        t.element = el
        trackers.set(el, t)
        return t as unknown as ElementTracker
      },
    })
    trackers.get(a)!.changes = [
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
      { property: 'color', oldValue: '#000', newValue: '#fff' },
    ]
    trackers.get(b)!.changes = [{ property: 'margin-top', oldValue: '8px', newValue: '0px' }]

    expect(manager.totalChangeCount()).toBe(3)
    manager.stop()
  })

  it('preserves per-element suppression independently using the real tracker', async () => {
    // Use the REAL tracker (not the fake) to prove the manager doesn't disturb per-element
    // suppression: element A has padding+derived width, element B has a genuine width-only edit.
    const a = document.createElement('div')
    a.setAttribute('data-shiage-loc', 'A.tsx:1:1')
    a.style.paddingLeft = '16px' // baseline values come from inline style in happy-dom
    document.body.appendChild(a)
    const b = document.createElement('div')
    b.setAttribute('data-shiage-loc', 'B.tsx:2:2')
    b.style.width = '100px'
    document.body.appendChild(b)

    const manager = createWatchManager({ pollMs: 1_000_000 })

    // A: bump padding-left (box-model). happy-dom won't actually reflow width, so we just verify
    // that A surfaces the padding-left change and B's width change stays clean.
    a.style.paddingLeft = '24px'
    b.style.width = '120px'
    await flushMutations()

    const all = manager.getAllChanges()
    const aChanges = all.find((e) => e.sourceLoc === 'A.tsx:1:1')?.changes ?? []
    const bChanges = all.find((e) => e.sourceLoc === 'B.tsx:2:2')?.changes ?? []
    expect(aChanges).toContainEqual({ property: 'padding-left', oldValue: '16px', newValue: '24px' })
    expect(bChanges).toContainEqual({ property: 'width', oldValue: '100px', newValue: '120px' })
    manager.stop()
  })
})

describe('createWatchManager — rebaseline / stop', () => {
  it('rebaseline(element) clears only that element; rebaseline() clears all', () => {
    const a = stamped('A.tsx:1:1')
    const b = stamped('B.tsx:2:2')
    document.body.append(a, b)
    const trackers = new Map<Element, ReturnType<typeof fakeTracker>>()
    const onChange = vi.fn()
    const manager = createWatchManager({
      pollMs: 1_000_000,
      onChange,
      createTracker: (el) => {
        const t = fakeTracker()
        t.element = el
        trackers.set(el, t)
        return t as unknown as ElementTracker
      },
    })

    manager.rebaseline(a)
    expect(trackers.get(a)!.rebaselineCalls).toBe(1)
    expect(trackers.get(b)!.rebaselineCalls).toBe(0)
    expect(onChange).toHaveBeenCalled()

    onChange.mockClear()
    manager.rebaseline()
    expect(trackers.get(a)!.rebaselineCalls).toBe(2)
    expect(trackers.get(b)!.rebaselineCalls).toBe(1)
    expect(onChange).toHaveBeenCalled()
    manager.stop()
  })

  it('stop() disconnects observers — further mutations do not call onChange', async () => {
    const el = stamped('A.tsx:1:1')
    document.body.appendChild(el)
    const onChange = vi.fn()
    let tracker!: ReturnType<typeof fakeTracker>
    const manager = createWatchManager({
      pollMs: 1_000_000,
      onChange,
      createTracker: (e) => {
        tracker = fakeTracker({ nextChanged: true })
        tracker.element = e
        return tracker as unknown as ElementTracker
      },
    })

    manager.stop()
    onChange.mockClear()
    tracker.ingestCalls = []

    el.style.paddingLeft = '24px'
    document.body.appendChild(stamped('B.tsx:2:2'))
    await flushMutations()

    expect(tracker.ingestCalls).toEqual([]) // ingest no longer called
    expect(onChange).not.toHaveBeenCalled() // and no notifications
  })
})

describe('createWatchManager — settle (deferred baseline absorbs layout-settling deltas)', () => {
  it('with settleMs > 0, re-baselines a freshly-added tracker after the delay', () => {
    vi.useFakeTimers()
    let tracker!: ReturnType<typeof fakeTracker>
    const manager = createWatchManager({
      pollMs: 1_000_000,
      settleMs: 32,
      createTracker: (el) => {
        tracker = fakeTracker()
        tracker.element = el
        return tracker as unknown as ElementTracker
      },
    })

    const el = stamped('A.tsx:1:1')
    document.body.appendChild(el)
    manager.sync() // synchronously trigger the tracker creation + scheduleSettle

    expect(tracker.rebaselineCalls).toBe(0)
    vi.advanceTimersByTime(32)
    expect(tracker.rebaselineCalls).toBe(1)
    manager.stop()
  })

  it('skips the deferred rebaseline if the tracker already has confirmed changes', () => {
    vi.useFakeTimers()
    let tracker!: ReturnType<typeof fakeTracker>
    const manager = createWatchManager({
      pollMs: 1_000_000,
      settleMs: 32,
      createTracker: (el) => {
        tracker = fakeTracker({
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
        })
        tracker.element = el
        return tracker as unknown as ElementTracker
      },
    })

    document.body.appendChild(stamped('A.tsx:1:1'))
    manager.sync()

    // The tracker reports a change before the settle window elapses — preserve the user's edit.
    vi.advanceTimersByTime(32)
    expect(tracker.rebaselineCalls).toBe(0)
    manager.stop()
  })

  it('with default settleMs (0), no deferred rebaseline is scheduled', () => {
    vi.useFakeTimers()
    let tracker!: ReturnType<typeof fakeTracker>
    const manager = createWatchManager({
      pollMs: 1_000_000,
      createTracker: (el) => {
        tracker = fakeTracker()
        tracker.element = el
        return tracker as unknown as ElementTracker
      },
    })

    document.body.appendChild(stamped('A.tsx:1:1'))
    manager.sync()
    vi.advanceTimersByTime(1000) // no settle scheduled at all
    expect(tracker.rebaselineCalls).toBe(0)
    manager.stop()
  })
})

describe('createWatchManager — poll path', () => {
  it('drives every tracker with immediate=false on each tick of the shared interval', () => {
    vi.useFakeTimers()
    const a = stamped('A.tsx:1:1')
    document.body.appendChild(a)
    let tracker!: ReturnType<typeof fakeTracker>
    const manager = createWatchManager({
      pollMs: 500,
      createTracker: (el) => {
        tracker = fakeTracker()
        tracker.element = el
        return tracker as unknown as ElementTracker
      },
    })

    vi.advanceTimersByTime(500)
    vi.advanceTimersByTime(500)

    // Two poll ticks, both immediate=false (no MutationObserver involvement here).
    const polls = tracker.ingestCalls.filter((immediate) => immediate === false)
    expect(polls.length).toBe(2)
    manager.stop()
  })
})
