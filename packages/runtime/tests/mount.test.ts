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

  it('sends a hello with the protocol version on connect', () => {
    const instance = mount({ wsUrl: 'ws://localhost:1234', WebSocketImpl: FakeWebSocket })
    const socket = FakeWebSocket.instances[0]!
    socket.open()
    const hello = socket.parsedSent().find((m) => m.type === 'hello')
    expect(hello).toMatchObject({ type: 'hello', protocolVersion: 2 })
    instance.unmount()
  })
})
