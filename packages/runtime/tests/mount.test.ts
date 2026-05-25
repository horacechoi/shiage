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

const flushMutations = async () => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  window.__SHIAGE__?.unmount()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  sessionStorage.clear()
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

  it('starts idle and toggles the panel from the pill', () => {
    const instance = mount({ autoConnect: false })
    const panel = instance.shadow.querySelector('.shiage-panel') as HTMLElement
    const pill = instance.shadow.querySelector('.shiage-pill') as HTMLButtonElement
    expect(panel.hidden).toBe(true)
    pill.click()
    expect(panel.hidden).toBe(false)
    expect(instance.shadow.querySelector('.shiage-body')!.textContent).toContain(
      'No element picked',
    )
  })

  it('unmount() removes the host and clears the global', () => {
    const instance = mount({ autoConnect: false })
    instance.unmount()
    expect(document.querySelector('[data-shiage-host]')).toBeNull()
    expect(window.__SHIAGE__).toBeUndefined()
  })

  it('restores the picked element from sessionStorage after an HMR reload', () => {
    sessionStorage.setItem('shiage:picked-loc', 'src/App.tsx:42:9')
    const button = document.createElement('button')
    button.setAttribute('data-shiage-loc', 'src/App.tsx:42:9')
    document.body.appendChild(button)

    const instance = mount({ autoConnect: false })
    const body = instance.shadow.querySelector('.shiage-body')!
    expect(body.textContent).toContain('src/App.tsx:42:9')
    expect(body.textContent).toContain('<button>')
  })

  it('drives pick → inline edit → save over the socket', async () => {
    const target = document.createElement('button')
    target.setAttribute('data-shiage-loc', 'src/App.tsx:10:5')
    target.setAttribute('class', 'p-4')
    target.style.paddingLeft = '16px'
    document.body.appendChild(target)

    const instance = mount({
      wsUrl: 'ws://localhost:1234',
      WebSocketImpl: FakeWebSocket,
      genSaveId: () => 'save-1',
    })
    const socket = FakeWebSocket.instances[0]!
    socket.open() // → status open → hello sent

    // Click "Pick element" in the panel, then pick the target on the page.
    instance.shadow.querySelector('.shiage-pill')!.dispatchEvent(new MouseEvent('click'))
    const pickBtn = [...instance.shadow.querySelectorAll('button')].find(
      (b) => b.textContent === 'Pick element',
    )!
    pickBtn.click()
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // Edit padding in "DevTools".
    target.style.paddingLeft = '24px'
    await flushMutations()

    const saveBtn = [...instance.shadow.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Save 1 change'),
    ) as HTMLButtonElement
    expect(saveBtn).toBeTruthy()
    expect(saveBtn.disabled).toBe(false)
    saveBtn.click()

    const save = socket.parsedSent().find((m) => m.type === 'save')
    expect(save).toEqual({
      type: 'save',
      saveId: 'save-1',
      sourceLoc: 'src/App.tsx:10:5',
      className: 'p-4',
      changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
      rootFontSizePx: 16,
    })
  })

  it('sends a hello with the protocol version on connect', () => {
    const instance = mount({ wsUrl: 'ws://localhost:1234', WebSocketImpl: FakeWebSocket })
    const socket = FakeWebSocket.instances[0]!
    socket.open()
    const hello = socket.parsedSent().find((m) => m.type === 'hello')
    expect(hello).toMatchObject({ type: 'hello', protocolVersion: 1 })
    instance.unmount()
  })
})
