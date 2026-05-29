// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '../src/mount'
import type { WebSocketLike } from '../src/client/ws-client'
import type { ClientMessage } from '@shiage/core/protocol'

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: string[] = []
  onopen: ((e: unknown) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  parsedSent(): ClientMessage[] {
    return this.sent.map((s) => JSON.parse(s) as ClientMessage)
  }
}

// Let happy-dom's MutationObserver microtasks run, plus the manager's structural-sync microtask
// and any setTimeout(0)-deferred work.
const flushMutations = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  window.__SHIAGE__?.unmount()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  FakeWebSocket.instances = []
})

describe('mount', () => {
  it('mounts a single closed-shadow host and is idempotent', () => {
    const first = mount({ autoConnect: false })
    const second = mount({ autoConnect: false })

    expect(second).toBe(first)
    expect(document.querySelectorAll('[data-shiage-host]')).toHaveLength(1)

    const host = document.querySelector('[data-shiage-host]')!
    expect(host.shadowRoot).toBeNull() // closed
    expect(first.shadow.querySelector('style')).toBeTruthy()
    expect(first.shadow.querySelector('.shiage-pill')).toBeTruthy()
  })

  it('starts in empty tracking and toggles the panel from the pill', () => {
    const instance = mount({ autoConnect: false })
    const panel = instance.shadow.querySelector('.shiage-panel') as HTMLElement
    const pill = instance.shadow.querySelector('.shiage-pill') as HTMLButtonElement
    expect(panel.hidden).toBe(true)
    pill.click()
    expect(panel.hidden).toBe(false)
    expect(instance.shadow.querySelector('.shiage-body')!.textContent).toContain(
      'Edit CSS in DevTools',
    )
  })

  it('unmount() removes the host and clears the global', () => {
    const instance = mount({ autoConnect: false })
    instance.unmount()
    expect(document.querySelector('[data-shiage-host]')).toBeNull()
    expect(window.__SHIAGE__).toBeUndefined()
  })

  it('tracks elements already in the DOM at boot and surfaces edits on them', async () => {
    const el = document.createElement('button')
    el.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    el.style.paddingLeft = '16px'
    document.body.appendChild(el)

    const instance = mount({ autoConnect: false })

    el.style.paddingLeft = '24px'
    await flushMutations()

    instance.panel.open()
    const text = instance.shadow.querySelector('.shiage-body')!.textContent ?? ''
    expect(text).toContain('src/App.tsx:1:1')
    expect(text).toContain('padding-left: 16px → 24px')
    expect(text).toContain('Save 1 change')
  })

  it('batches ambient edits across multiple elements into a single save message', async () => {
    const a = document.createElement('div')
    a.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    a.setAttribute('class', 'p-4')
    a.style.paddingLeft = '16px'
    document.body.appendChild(a)
    const b = document.createElement('button')
    b.setAttribute('data-shiage-loc', 'src/App.tsx:2:2')
    b.setAttribute('class', 'p-2')
    b.style.paddingLeft = '8px'
    document.body.appendChild(b)

    const instance = mount({
      wsUrl: 'ws://localhost:1234',
      WebSocketImpl: FakeWebSocket,
      genSaveId: () => 'save-1',
    })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    a.style.paddingLeft = '24px'
    b.style.paddingLeft = '16px'
    await flushMutations()

    const save = [...instance.shadow.querySelectorAll('button')].find((btn) =>
      btn.textContent?.startsWith('Save 2 changes'),
    ) as HTMLButtonElement
    expect(save).toBeTruthy()
    expect(save.disabled).toBe(false)
    save.click()

    const sent = socket.parsedSent().find((m) => m.type === 'save')
    expect(sent).toBeTruthy()
    if (sent?.type !== 'save') throw new Error('expected save')
    expect(sent.saveId).toBe('save-1')
    expect(sent.edits).toHaveLength(2)
    const byLoc = new Map(sent.edits.map((e) => [e.sourceLoc, e]))
    expect(byLoc.get('src/App.tsx:1:1')!.changes).toContainEqual({
      property: 'padding-left',
      oldValue: '16px',
      newValue: '24px',
    })
    expect(byLoc.get('src/App.tsx:2:2')!.changes).toContainEqual({
      property: 'padding-left',
      oldValue: '8px',
      newValue: '16px',
    })
  })

  it('honors per-element exclusion: an unchecked element is dropped from the save', async () => {
    const a = document.createElement('div')
    a.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    a.setAttribute('class', 'p-4')
    a.style.paddingLeft = '16px'
    document.body.appendChild(a)
    const b = document.createElement('button')
    b.setAttribute('data-shiage-loc', 'src/App.tsx:2:2')
    b.setAttribute('class', 'p-2')
    b.style.paddingLeft = '8px'
    document.body.appendChild(b)

    const instance = mount({
      wsUrl: 'ws://localhost:1234',
      WebSocketImpl: FakeWebSocket,
      genSaveId: () => 'save-1',
    })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    a.style.paddingLeft = '24px'
    b.style.paddingLeft = '16px'
    await flushMutations()

    // Untick the second element's group checkbox.
    const groups = instance.shadow.querySelectorAll('.shiage-group')
    expect(groups).toHaveLength(2)
    const secondHead = groups[1]!.querySelector('.shiage-group__head') as HTMLElement
    const headBox = secondHead.querySelector('input[type="checkbox"]') as HTMLInputElement
    headBox.checked = false
    headBox.dispatchEvent(new Event('change'))

    // After the toggle, the panel re-renders with includedCount=1.
    const save = [...instance.shadow.querySelectorAll('button')].find((btn) =>
      btn.textContent?.startsWith('Save 1 change'),
    ) as HTMLButtonElement
    expect(save).toBeTruthy()
    save.click()

    const sent = socket.parsedSent().find((m) => m.type === 'save')
    if (sent?.type !== 'save') throw new Error('expected save')
    expect(sent.edits).toHaveLength(1)
    expect(sent.edits[0]!.sourceLoc).toBe('src/App.tsx:1:1')
  })

  it('Remove pins all changes to baseline and removes the group from the panel', async () => {
    const a = document.createElement('div')
    a.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    a.setAttribute('class', 'p-4')
    a.style.paddingLeft = '16px'
    document.body.appendChild(a)
    const b = document.createElement('button')
    b.setAttribute('data-shiage-loc', 'src/App.tsx:2:2')
    b.setAttribute('class', 'p-2')
    b.style.paddingLeft = '8px'
    document.body.appendChild(b)

    const instance = mount({ autoConnect: false })

    a.style.paddingLeft = '24px'
    b.style.paddingLeft = '16px'
    await flushMutations()
    expect(instance.manager.getAllChanges()).toHaveLength(2)

    // Click Remove on the first group.
    const groups = instance.shadow.querySelectorAll('.shiage-group')
    const firstRemove = groups[0]!.querySelector('.shiage-group__remove') as HTMLButtonElement
    firstRemove.click()
    await flushMutations()

    // The hold pinned padding-left back to 16px !important inline.
    expect(a.style.getPropertyValue('padding-left')).toBe('16px')
    expect(a.style.getPropertyPriority('padding-left')).toBe('important')
    // Tracker no longer reports the removed element (rebaselined + auto-cleared by the override).
    const live = instance.manager.getAllChanges()
    expect(live.find((e) => e.sourceLoc === 'src/App.tsx:1:1')).toBeUndefined()

    // Only the OTHER group remains in the panel — the removed group is gone.
    const groupsAfter = [...instance.shadow.querySelectorAll('.shiage-group')]
    expect(groupsAfter).toHaveLength(1)
    expect(groupsAfter[0]!.textContent).toContain('src/App.tsx:2:2')
    expect(groupsAfter[0]!.textContent).not.toContain('src/App.tsx:1:1')
    // Save button reflects only the surviving element's count.
    const save = [...instance.shadow.querySelectorAll('button')].find((btn) =>
      btn.textContent?.startsWith('Save 1 change'),
    ) as HTMLButtonElement
    expect(save).toBeTruthy()
    expect(save.disabled).toBe(false)
  })

  it('Remove preview is sticky: a host-app inline wipe is re-pinned on the next render tick', async () => {
    const a = document.createElement('div')
    a.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    a.setAttribute('class', 'p-4')
    a.style.paddingLeft = '16px'
    document.body.appendChild(a)

    const instance = mount({ autoConnect: false })

    a.style.paddingLeft = '24px'
    await flushMutations()

    const remove = instance.shadow.querySelector('.shiage-group__remove') as HTMLButtonElement
    remove.click()
    await flushMutations()
    expect(a.style.getPropertyValue('padding-left')).toBe('16px')
    expect(a.style.getPropertyPriority('padding-left')).toBe('important')

    // Simulate React / HMR clearing the inline override on the live element. Any subsequent
    // render tick should detect the drift and re-pin via reapplyHolds.
    a.style.removeProperty('padding-left')
    expect(a.style.getPropertyValue('padding-left')).toBe('')

    // Drive a render — anything that triggers onChange will do; mutate an unrelated stamped
    // element so the structural observer fires.
    const trigger = document.createElement('span')
    trigger.setAttribute('data-shiage-loc', 'src/App.tsx:9:9')
    document.body.appendChild(trigger)
    await flushMutations()

    expect(a.style.getPropertyValue('padding-left')).toBe('16px')
    expect(a.style.getPropertyPriority('padding-left')).toBe('important')
  })

  it('per-property hold: unticking pins to baseline + struck row; re-ticking restores the DevTools edit', async () => {
    const a = document.createElement('div')
    a.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    a.setAttribute('class', 'p-4')
    a.style.paddingLeft = '16px' // baseline
    document.body.appendChild(a)

    const instance = mount({ autoConnect: false })

    // The "DevTools edit": inline 24px.
    a.style.paddingLeft = '24px'
    await flushMutations()

    // Untick the property row.
    const propBox = instance.shadow
      .querySelector('.shiage-prop')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement
    propBox.checked = false
    propBox.dispatchEvent(new Event('change'))
    await flushMutations()

    // Override is in place at baseline.
    expect(a.style.getPropertyValue('padding-left')).toBe('16px')
    expect(a.style.getPropertyPriority('padding-left')).toBe('important')
    // Snapshot row survives the tracker's auto-clear.
    const row = instance.shadow.querySelector('.shiage-prop')!
    expect(row.classList.contains('shiage-prop--excluded')).toBe(true)
    expect(row.textContent).toContain('padding-left: 16px → 24px')

    // Re-tick the row → release the hold → restore the captured inline edit (24px, no priority).
    const reBox = instance.shadow
      .querySelector('.shiage-prop')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement
    reBox.checked = true
    reBox.dispatchEvent(new Event('change'))
    await flushMutations()
    expect(a.style.getPropertyValue('padding-left')).toBe('24px')
    expect(a.style.getPropertyPriority('padding-left')).toBe('')
    // Tracker re-detects the change → row goes back to checked + un-struck.
    const liveRow = instance.shadow.querySelector('.shiage-prop')!
    expect(liveRow.classList.contains('shiage-prop--excluded')).toBe(false)
  })

  it('per-element + per-property precedence: re-ticking the element keeps individually unticked props held', async () => {
    const el = document.createElement('div')
    el.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    el.setAttribute('class', 'p-4')
    el.style.paddingLeft = '16px'
    el.style.paddingRight = '16px'
    document.body.appendChild(el)

    const instance = mount({ autoConnect: false })

    el.style.paddingLeft = '24px'
    el.style.paddingRight = '32px'
    await flushMutations()
    const live = instance.manager.getAllChanges()
    expect(live[0]!.changes.map((c) => c.property).sort()).toEqual(['padding-left', 'padding-right'])

    // Untick padding-left specifically (the property row that mentions 'padding-left: 16px → 24px').
    const rows = [...instance.shadow.querySelectorAll('.shiage-prop')]
    const leftRow = rows.find((r) => r.textContent?.includes('padding-left'))!
    const leftBox = leftRow.querySelector('input[type="checkbox"]') as HTMLInputElement
    leftBox.checked = false
    leftBox.dispatchEvent(new Event('change'))
    await flushMutations()
    expect(el.style.getPropertyValue('padding-left')).toBe('16px')
    expect(el.style.getPropertyPriority('padding-left')).toBe('important')
    expect(el.style.getPropertyValue('padding-right')).toBe('32px') // still live

    // Untick the whole element → padding-right is now also held.
    const headBox = instance.shadow
      .querySelector('.shiage-group__head')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement
    headBox.checked = false
    headBox.dispatchEvent(new Event('change'))
    await flushMutations()
    expect(el.style.getPropertyValue('padding-right')).toBe('16px')
    expect(el.style.getPropertyPriority('padding-right')).toBe('important')

    // Re-tick the element → padding-right is released (the user's per-element intent is gone),
    // padding-left STAYS held (the user's per-property unstick still stands).
    const reHead = instance.shadow
      .querySelector('.shiage-group__head')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement
    reHead.checked = true
    reHead.dispatchEvent(new Event('change'))
    await flushMutations()
    expect(el.style.getPropertyValue('padding-left')).toBe('16px')
    expect(el.style.getPropertyPriority('padding-left')).toBe('important')
    expect(el.style.getPropertyValue('padding-right')).toBe('32px')
    expect(el.style.getPropertyPriority('padding-right')).toBe('')
  })

  it('new edits on a Removed element track normally (and the held properties stay invisible)', async () => {
    const el = document.createElement('div')
    el.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    el.style.paddingLeft = '16px'
    el.style.color = 'rgb(0, 0, 0)'
    document.body.appendChild(el)

    const instance = mount({ autoConnect: false })

    el.style.paddingLeft = '24px'
    await flushMutations()
    const remove = instance.shadow.querySelector('.shiage-group__remove') as HTMLButtonElement
    remove.click()
    await flushMutations()
    // After Remove, no group renders for this element.
    expect(instance.shadow.querySelectorAll('.shiage-group')).toHaveLength(0)

    // Now a NEW DevTools edit on a different property.
    el.style.color = 'rgb(255, 0, 0)'
    await flushMutations()

    // The removed property is still pinned (no UI for it); the new edit shows up as a fresh group
    // with a single live row.
    expect(el.style.getPropertyValue('padding-left')).toBe('16px')
    expect(el.style.getPropertyPriority('padding-left')).toBe('important')
    const groups = instance.shadow.querySelectorAll('.shiage-group')
    expect(groups).toHaveLength(1)
    const rows = [...groups[0]!.querySelectorAll('.shiage-prop')]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('color')
    expect(rows[0]!.classList.contains('shiage-prop--excluded')).toBe(false)
    // Save reflects the single live color change.
    expect(
      [...instance.shadow.querySelectorAll('button')].find((b) =>
        b.textContent?.startsWith('Save 1 change'),
      ),
    ).toBeTruthy()
  })

  it('apply-result success removes inline overrides for saved props and releases all holds', async () => {
    const a = document.createElement('div')
    a.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    a.setAttribute('class', 'p-4')
    a.style.paddingLeft = '16px'
    document.body.appendChild(a)
    const b = document.createElement('button')
    b.setAttribute('data-shiage-loc', 'src/App.tsx:2:2')
    b.setAttribute('class', 'p-2')
    b.style.paddingLeft = '8px'
    document.body.appendChild(b)

    const instance = mount({
      wsUrl: 'ws://localhost:1234',
      WebSocketImpl: FakeWebSocket,
      genSaveId: () => 'save-1',
    })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    // a is going to be saved; b is going to be Removed (held).
    a.style.paddingLeft = '24px'
    b.style.paddingLeft = '16px'
    await flushMutations()

    // Remove b → remove-origin hold (no snapshot; b's group disappears from the panel).
    const groups = instance.shadow.querySelectorAll('.shiage-group')
    const bGroup = [...groups].find((g) => g.textContent?.includes('src/App.tsx:2:2'))!
    ;(bGroup.querySelector('.shiage-group__remove') as HTMLButtonElement).click()
    await flushMutations()
    expect(b.style.getPropertyPriority('padding-left')).toBe('important')

    // Save what's left live (just a).
    const save = [...instance.shadow.querySelectorAll('button')].find((btn) =>
      btn.textContent?.startsWith('Save 1 change'),
    ) as HTMLButtonElement
    save.click()
    const sentSave = socket.parsedSent().find((m) => m.type === 'save')!
    if (sentSave.type !== 'save') throw new Error('expected save')
    expect(sentSave.edits.map((e) => e.sourceLoc)).toEqual(['src/App.tsx:1:1'])

    // Server reports success.
    socket.onmessage?.({
      data: JSON.stringify({ type: 'apply-result', saveId: 'save-1', success: true }),
    })

    // a's saved property is `removeProperty`'d unconditionally; the user-inline 24px is gone too,
    // letting HMR repaint with the new Tailwind class.
    expect(a.style.getPropertyValue('padding-left')).toBe('')
    // b's remove-origin hold released → originalInline ('16px' captured at hold time, the user's
    // "DevTools" inline edit) restored.
    expect(b.style.getPropertyValue('padding-left')).toBe('16px')
    expect(b.style.getPropertyPriority('padding-left')).toBe('')
    // Panel transitioned to applied view (icon-prefixed title — see panel.ts ICONS.check).
    expect(instance.shadow.querySelector('.shiage-body')!.textContent).toContain('Saved')
    expect(instance.shadow.querySelector('.shiage-title-icon svg')).toBeTruthy()
  })

  it('apply-result failure preserves holds, snapshots, and exclusions for retry', async () => {
    const a = document.createElement('div')
    a.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    a.setAttribute('class', 'p-4')
    a.style.paddingLeft = '16px'
    document.body.appendChild(a)

    const instance = mount({
      wsUrl: 'ws://localhost:1234',
      WebSocketImpl: FakeWebSocket,
      genSaveId: () => 'save-1',
    })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    a.style.paddingLeft = '24px'
    await flushMutations()

    // Remove a → remove-origin hold (no snapshot; a's group disappears from the panel).
    ;(instance.shadow.querySelector('.shiage-group__remove') as HTMLButtonElement).click()
    await flushMutations()
    expect(a.style.getPropertyPriority('padding-left')).toBe('important')

    // Force a save through (even with no live changes, ensure the apply-result path triggers).
    // We'll add a second element with a live change to make the save have content.
    const b = document.createElement('div')
    b.setAttribute('data-shiage-loc', 'src/App.tsx:2:2')
    b.setAttribute('class', 'p-2')
    b.style.paddingLeft = '8px'
    document.body.appendChild(b)
    await flushMutations()
    b.style.paddingLeft = '16px'
    await flushMutations()
    const save = [...instance.shadow.querySelectorAll('button')].find((btn) =>
      btn.textContent?.startsWith('Save'),
    ) as HTMLButtonElement
    save.click()

    socket.onmessage?.({
      data: JSON.stringify({
        type: 'apply-result',
        saveId: 'save-1',
        success: false,
        error: 'boom',
      }),
    })

    // Hold on `a` survives.
    expect(a.style.getPropertyValue('padding-left')).toBe('16px')
    expect(a.style.getPropertyPriority('padding-left')).toBe('important')
    // Error view is shown.
    expect(instance.shadow.querySelector('.shiage-body')!.textContent).toContain('boom')
  })

  it('snapshot row survives the tracker auto-clear after an exclusion', async () => {
    const a = document.createElement('div')
    a.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    a.setAttribute('class', 'p-4')
    a.style.paddingLeft = '16px'
    document.body.appendChild(a)

    const instance = mount({ autoConnect: false })
    a.style.paddingLeft = '24px'
    await flushMutations()
    expect(instance.manager.getAllChanges()).toHaveLength(1)

    // Untick → hold applied → tracker auto-clears (computed = baseline). Snapshot keeps the row.
    const propBox = instance.shadow
      .querySelector('.shiage-prop')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement
    propBox.checked = false
    propBox.dispatchEvent(new Event('change'))
    await flushMutations()
    expect(instance.manager.getAllChanges()).toHaveLength(0)
    // Group + row still rendered (from snapshot).
    expect(instance.shadow.querySelectorAll('.shiage-group')).toHaveLength(1)
    expect(instance.shadow.querySelector('.shiage-prop')!.textContent).toContain(
      'padding-left: 16px → 24px',
    )
  })

  it('checkbox toggles preserve the row order across renders', async () => {
    // Three changes appear in order: padding-left, color, font-size. Unticking padding-left auto-
    // clears it from the tracker; without the sticky order map, the snapshot loop would append it
    // *after* color and font-size, shuffling the panel. With the fix, padding-left stays in slot 0.
    const el = document.createElement('div')
    el.setAttribute('data-shiage-loc', 'src/App.tsx:1:1')
    el.setAttribute('class', 'p-4')
    el.style.paddingLeft = '16px'
    el.style.color = 'rgb(0, 0, 0)'
    el.style.fontSize = '14px'
    document.body.appendChild(el)

    const instance = mount({ autoConnect: false })
    el.style.paddingLeft = '24px'
    await flushMutations()
    el.style.color = 'rgb(255, 0, 0)'
    await flushMutations()
    el.style.fontSize = '18px'
    await flushMutations()

    const orderBefore = [...instance.shadow.querySelectorAll('.shiage-prop')].map((r) =>
      (r.textContent ?? '').split(':')[0]?.trim(),
    )
    expect(orderBefore).toEqual(['padding-left', 'color', 'font-size'])

    // Untick the first row (padding-left).
    const firstBox = instance.shadow
      .querySelectorAll('.shiage-prop')[0]!
      .querySelector('input[type="checkbox"]') as HTMLInputElement
    firstBox.checked = false
    firstBox.dispatchEvent(new Event('change'))
    await flushMutations()

    const orderAfter = [...instance.shadow.querySelectorAll('.shiage-prop')].map((r) =>
      (r.textContent ?? '').split(':')[0]?.trim(),
    )
    expect(orderAfter).toEqual(['padding-left', 'color', 'font-size'])
    // And the unticked row is struck.
    const rows = instance.shadow.querySelectorAll('.shiage-prop')
    expect(rows[0]!.classList.contains('shiage-prop--excluded')).toBe(true)
    expect(rows[1]!.classList.contains('shiage-prop--excluded')).toBe(false)
    expect(rows[2]!.classList.contains('shiage-prop--excluded')).toBe(false)

    // Re-tick. Order still stable.
    const reBox = instance.shadow
      .querySelectorAll('.shiage-prop')[0]!
      .querySelector('input[type="checkbox"]') as HTMLInputElement
    reBox.checked = true
    reBox.dispatchEvent(new Event('change'))
    await flushMutations()
    const orderRecheck = [...instance.shadow.querySelectorAll('.shiage-prop')].map((r) =>
      (r.textContent ?? '').split(':')[0]?.trim(),
    )
    expect(orderRecheck).toEqual(['padding-left', 'color', 'font-size'])
  })

  it('sends a hello with the protocol version on connect', () => {
    const instance = mount({ wsUrl: 'ws://localhost:1234', WebSocketImpl: FakeWebSocket })
    const socket = FakeWebSocket.instances[0]!
    socket.open()
    const hello = socket.parsedSent().find((m) => m.type === 'hello')
    expect(hello).toMatchObject({ type: 'hello', protocolVersion: 2 })
    instance.unmount()
  })
})
