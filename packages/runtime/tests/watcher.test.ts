// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createWatcher } from '../src/watcher/watcher'
import type { SupportedProperty } from '@shiage/core/supported'

// Let happy-dom's MutationObserver callback (microtask, possibly a macrotask) run.
const flushMutations = async () => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// A partial computed snapshot; unlisted properties read as '' (matching happy-dom's bare defaults).
const snap = (values: Record<string, string>): Map<SupportedProperty, string> =>
  new Map(Object.entries(values)) as Map<SupportedProperty, string>

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('createWatcher — MutationObserver path (inline edits)', () => {
  it('catches an inline style edit immediately, without waiting for a poll', async () => {
    const el = document.createElement('div')
    el.style.paddingLeft = '16px'
    document.body.appendChild(el)
    // Poll effectively disabled so only the MutationObserver can act.
    const watcher = createWatcher(el, { pollMs: 1_000_000 })

    el.style.paddingLeft = '24px'
    await flushMutations()

    expect(watcher.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ])
    watcher.stop()
  })

  it('reports multiple simultaneously-edited properties', async () => {
    const el = document.createElement('div')
    el.style.paddingLeft = '16px'
    el.style.marginTop = '8px'
    document.body.appendChild(el)
    const watcher = createWatcher(el, { pollMs: 1_000_000 })

    el.style.paddingLeft = '24px'
    el.style.marginTop = '0px'
    await flushMutations()

    const changes = watcher.getCurrentChanges()
    expect(changes).toHaveLength(2)
    expect(changes).toContainEqual({ property: 'padding-left', oldValue: '16px', newValue: '24px' })
    expect(changes).toContainEqual({ property: 'margin-top', oldValue: '8px', newValue: '0px' })
    watcher.stop()
  })

  it('drops a change when the value reverts to the baseline', async () => {
    const el = document.createElement('div')
    el.style.paddingLeft = '16px'
    document.body.appendChild(el)
    const watcher = createWatcher(el, { pollMs: 1_000_000 })

    el.style.paddingLeft = '24px'
    await flushMutations()
    expect(watcher.getCurrentChanges()).toHaveLength(1)

    el.style.paddingLeft = '16px'
    await flushMutations()
    expect(watcher.getCurrentChanges()).toEqual([])
    watcher.stop()
  })

  it('fires onChange when the confirmed set changes', async () => {
    const el = document.createElement('div')
    el.style.paddingLeft = '16px'
    document.body.appendChild(el)
    const onChange = vi.fn()
    const watcher = createWatcher(el, { pollMs: 1_000_000, onChange })

    el.style.paddingLeft = '24px'
    await flushMutations()
    expect(onChange).toHaveBeenCalled()
    watcher.stop()
  })

  it('rebaseline() clears changes and re-diffs against the new baseline', async () => {
    const el = document.createElement('div')
    el.style.paddingLeft = '16px'
    document.body.appendChild(el)
    const watcher = createWatcher(el, { pollMs: 1_000_000 })

    el.style.paddingLeft = '24px'
    await flushMutations()
    expect(watcher.getCurrentChanges()).toHaveLength(1)

    watcher.rebaseline()
    expect(watcher.getCurrentChanges()).toEqual([])

    el.style.paddingLeft = '32px'
    await flushMutations()
    expect(watcher.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '24px', newValue: '32px' },
    ])
    watcher.stop()
  })
})

describe('createWatcher — poll path (stylesheet-rule edits)', () => {
  it('catches a stylesheet-rule edit via the poll, which the MutationObserver never sees', async () => {
    vi.useFakeTimers()
    const style = document.createElement('style')
    style.textContent = '.poll-target { padding-left: 16px; }'
    document.head.appendChild(style)
    const el = document.createElement('div')
    el.className = 'poll-target'
    document.body.appendChild(el)

    const watcher = createWatcher(el, { pollMs: 500 })

    // Edit the matching rule. The element's own style/class attributes are untouched, so the
    // MutationObserver does not fire — only the computed value changes.
    style.textContent = '.poll-target { padding-left: 24px; }'
    await Promise.resolve()
    expect(watcher.getCurrentChanges()).toEqual([]) // MutationObserver path saw nothing

    vi.advanceTimersByTime(500) // poll 1: sees 24px, not yet stable vs the baseline
    expect(watcher.getCurrentChanges()).toEqual([])

    vi.advanceTimersByTime(500) // poll 2: 24px stable across two polls → confirmed
    expect(watcher.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ])
    watcher.stop()
  })

  it('requires two stable polls before counting a change (transition-in-flight guard)', () => {
    vi.useFakeTimers()
    const snapshots = [
      snap({ 'padding-left': '16px' }), // baseline (read at create)
      snap({ 'padding-left': '20px' }), // poll 1: mid-transition
      snap({ 'padding-left': '24px' }), // poll 2: still moving (differs from poll 1)
      snap({ 'padding-left': '24px' }), // poll 3: settled (matches poll 2)
    ]
    let i = 0
    const readAll = () => snapshots[Math.min(i++, snapshots.length - 1)]!
    const watcher = createWatcher(document.createElement('div'), { pollMs: 500, readAll })

    vi.advanceTimersByTime(500) // poll 1 → 20px, unstable
    expect(watcher.getCurrentChanges()).toEqual([])
    vi.advanceTimersByTime(500) // poll 2 → 24px, differs from poll 1 → still unstable
    expect(watcher.getCurrentChanges()).toEqual([])
    vi.advanceTimersByTime(500) // poll 3 → 24px, matches poll 2 → confirmed
    expect(watcher.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ])
    watcher.stop()
  })

  it('ignores sub-pixel computed differences on the poll path', () => {
    vi.useFakeTimers()
    const snapshots = [
      snap({ 'padding-left': '24px' }),
      snap({ 'padding-left': '23.999px' }),
      snap({ 'padding-left': '23.999px' }),
    ]
    let i = 0
    const readAll = () => snapshots[Math.min(i++, snapshots.length - 1)]!
    const watcher = createWatcher(document.createElement('div'), { pollMs: 500, readAll })

    vi.advanceTimersByTime(500)
    vi.advanceTimersByTime(500)
    expect(watcher.getCurrentChanges()).toEqual([])
    watcher.stop()
  })
})

describe('createWatcher — redundant-reflection filtering', () => {
  it('ignores a box-model shorthand that merely reflects a longhand edit', () => {
    vi.useFakeTimers()
    // Editing padding-left also changes the `padding` shorthand's computed string. The watcher
    // tracks longhands only, so the shorthand never counts as its own change.
    const snapshots = [
      snap({ 'padding-left': '16px', padding: '8px 16px' }),
      snap({ 'padding-left': '24px', padding: '8px 16px 8px 24px' }),
      snap({ 'padding-left': '24px', padding: '8px 16px 8px 24px' }),
    ]
    let i = 0
    const readAll = () => snapshots[Math.min(i++, snapshots.length - 1)]!
    const watcher = createWatcher(document.createElement('div'), { pollMs: 500, readAll })

    vi.advanceTimersByTime(500)
    vi.advanceTimersByTime(500)
    expect(watcher.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ])
    watcher.stop()
  })

  it('suppresses a width change reflowed by a padding edit (width not authored)', () => {
    vi.useFakeTimers()
    // An auto-width element: a padding edit widens it, so `width` changes too — but the user only
    // touched padding, so the derived width must not be written back as a hardcoded w-[Npx].
    const snapshots = [
      snap({ 'padding-left': '16px', width: '100px' }), // baseline
      snap({ 'padding-left': '24px', width: '108px' }), // poll 1
      snap({ 'padding-left': '24px', width: '108px' }), // poll 2 (stable) → both confirmed
    ]
    let i = 0
    const readAll = () => snapshots[Math.min(i++, snapshots.length - 1)]!
    const watcher = createWatcher(document.createElement('div'), { pollMs: 500, readAll })

    vi.advanceTimersByTime(500)
    vi.advanceTimersByTime(500)
    expect(watcher.getCurrentChanges()).toEqual([
      { property: 'padding-left', oldValue: '16px', newValue: '24px' },
    ])
    watcher.stop()
  })

  it('keeps a width change the user authored inline alongside a padding edit', async () => {
    const el = document.createElement('div')
    el.style.paddingLeft = '16px'
    el.style.width = '100px'
    document.body.appendChild(el)
    const watcher = createWatcher(el, { pollMs: 1_000_000 })

    el.style.paddingLeft = '24px'
    el.style.width = '120px' // explicit width edit — authored inline, so it survives suppression
    await flushMutations()

    const changes = watcher.getCurrentChanges()
    expect(changes).toContainEqual({ property: 'padding-left', oldValue: '16px', newValue: '24px' })
    expect(changes).toContainEqual({ property: 'width', oldValue: '100px', newValue: '120px' })
    watcher.stop()
  })

  it('drops a non-inline width change even when no box-model property was edited', () => {
    vi.useFakeTimers()
    // The DevTools-docking case: a stylesheet rule resolves smaller (e.g. `100dvh` shrinking when
    // DevTools docks) and the watcher's poll sees the new computed width — but the user never
    // typed it into the element's `style {}` block, so we can't trust it as a deliberate edit.
    const snapshots = [snap({ width: '100px' }), snap({ width: '120px' }), snap({ width: '120px' })]
    let i = 0
    const readAll = () => snapshots[Math.min(i++, snapshots.length - 1)]!
    const watcher = createWatcher(document.createElement('div'), { pollMs: 500, readAll })

    vi.advanceTimersByTime(500)
    vi.advanceTimersByTime(500)
    expect(watcher.getCurrentChanges()).toEqual([])
    watcher.stop()
  })

  it('keeps a width change the user authored inline, even with no box-model edit', async () => {
    // The deliberate-edit path: typing `width: 120px` into DevTools' `element.style {}` block
    // mutates the `style` attribute → `authoredInline` is true → kept.
    const el = document.createElement('div')
    el.style.width = '120px'
    document.body.appendChild(el)
    const watcher = createWatcher(el, { pollMs: 1_000_000 })

    el.style.width = '160px'
    await flushMutations()

    expect(watcher.getCurrentChanges()).toEqual([
      { property: 'width', oldValue: '120px', newValue: '160px' },
    ])
    watcher.stop()
  })
})

describe('createWatcher — animation probe', () => {
  it('does not record an inline change to a property reported as animating', async () => {
    const el = document.createElement('div')
    el.style.opacity = '0'
    document.body.appendChild(el)
    const watcher = createWatcher(el, {
      pollMs: 1_000_000,
      getAnimatingProperties: () => new Set<SupportedProperty>(['opacity']),
    })

    el.style.opacity = '1'
    await flushMutations()

    // opacity is under an active animation → the change is absorbed, not recorded.
    expect(watcher.getCurrentChanges()).toEqual([])
    watcher.stop()
  })
})
