import { describe, it, expect, vi, afterEach } from 'vitest'
import { createWsClient, type WebSocketLike } from '../src/client/ws-client'
import type { ServerMessage } from '@shiage/core/protocol'

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = []
  readyState = 0 // CONNECTING
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
    this.onclose?.({})
  }
  // ── test helpers ──
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  emit(data: unknown) {
    this.onmessage?.({ data })
  }
  serverClose() {
    this.readyState = 3
    this.onclose?.({})
  }
}

afterEach(() => {
  FakeWebSocket.instances = []
  vi.useRealTimers()
})

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!

describe('createWsClient', () => {
  it('connects on creation and reports open', () => {
    const onStatusChange = vi.fn()
    const client = createWsClient({
      url: 'ws://x',
      onMessage: () => {},
      onStatusChange,
      WebSocketImpl: FakeWebSocket,
    })
    expect(client.status).toBe('connecting')
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(last().url).toBe('ws://x')

    last().open()
    expect(client.status).toBe('open')
    expect(onStatusChange).toHaveBeenCalledWith('connecting')
    expect(onStatusChange).toHaveBeenCalledWith('open')
  })

  it('sends framed JSON when open', () => {
    const client = createWsClient({
      url: 'ws://x',
      onMessage: () => {},
      WebSocketImpl: FakeWebSocket,
    })
    last().open()
    client.send({ type: 'apply', saveId: 's1' })
    expect(last().sent).toEqual([JSON.stringify({ type: 'apply', saveId: 's1' })])
  })

  it('queues messages sent before open and flushes them on connect', () => {
    const client = createWsClient({
      url: 'ws://x',
      onMessage: () => {},
      WebSocketImpl: FakeWebSocket,
    })
    client.send({ type: 'hello', runtimeVersion: '0.0.0', protocolVersion: 1 })
    expect(last().sent).toEqual([]) // not open yet
    last().open()
    expect(last().sent).toEqual([
      JSON.stringify({ type: 'hello', runtimeVersion: '0.0.0', protocolVersion: 1 }),
    ])
  })

  it('parses incoming frames and delivers ServerMessages', () => {
    const onMessage = vi.fn<(m: ServerMessage) => void>()
    createWsClient({ url: 'ws://x', onMessage, WebSocketImpl: FakeWebSocket })
    last().open()
    const msg: ServerMessage = { type: 'apply-result', saveId: 's1', success: true }
    last().emit(JSON.stringify(msg))
    expect(onMessage).toHaveBeenCalledWith(msg)
  })

  it('ignores malformed frames without throwing', () => {
    const onMessage = vi.fn()
    createWsClient({ url: 'ws://x', onMessage, WebSocketImpl: FakeWebSocket })
    last().open()
    expect(() => last().emit('not json{')).not.toThrow()
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('reconnects with exponential backoff after an unexpected close', () => {
    vi.useFakeTimers()
    createWsClient({
      url: 'ws://x',
      onMessage: () => {},
      WebSocketImpl: FakeWebSocket,
      reconnect: { baseMs: 100, maxMs: 10_000 },
    })
    expect(FakeWebSocket.instances).toHaveLength(1)

    last().serverClose() // first drop → reconnect after base (100ms)
    vi.advanceTimersByTime(99)
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(2)

    last().serverClose() // second consecutive drop → backoff doubles to 200ms
    vi.advanceTimersByTime(100)
    expect(FakeWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(100)
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('resets backoff after a successful open', () => {
    vi.useFakeTimers()
    createWsClient({
      url: 'ws://x',
      onMessage: () => {},
      WebSocketImpl: FakeWebSocket,
      reconnect: { baseMs: 100 },
    })
    last().serverClose()
    vi.advanceTimersByTime(100)
    expect(FakeWebSocket.instances).toHaveLength(2)
    last().open() // success resets the backoff counter
    last().serverClose()
    vi.advanceTimersByTime(100) // back to the base delay, not doubled
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('does not reconnect after a manual close', () => {
    vi.useFakeTimers()
    const client = createWsClient({
      url: 'ws://x',
      onMessage: () => {},
      WebSocketImpl: FakeWebSocket,
      reconnect: { baseMs: 100 },
    })
    last().open()
    client.close()
    expect(client.status).toBe('closed')
    vi.advanceTimersByTime(10_000)
    expect(FakeWebSocket.instances).toHaveLength(1) // no new socket
  })
})
