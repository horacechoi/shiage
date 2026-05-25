// The runtime's WebSocket transport to the dev-server plugin. It frames messages as JSON, queues
// anything sent while not open and flushes on connect, and transparently reconnects with capped
// exponential backoff so an HMR restart of the dev server doesn't permanently sever the overlay.
// It is intentionally a dumb pipe: it delivers parsed ServerMessages and sends ClientMessages.
// Request/response correlation by `saveId` is the orchestrator's job (it owns the saveId).
import type { ClientMessage, ServerMessage } from '@shiage/core/protocol'

export type WsStatus = 'connecting' | 'open' | 'closed'

/** The slice of the WebSocket API we use — lets tests inject a fake socket. */
export interface WebSocketLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
}

type WebSocketCtor = new (url: string) => WebSocketLike

export interface WsClientOptions {
  url: string
  onMessage: (message: ServerMessage) => void
  onStatusChange?: (status: WsStatus) => void
  /** WebSocket constructor; defaults to the global. Injectable for tests. */
  WebSocketImpl?: WebSocketCtor
  /** Reconnect backoff bounds (ms). Defaults: base 500, max 10000. */
  reconnect?: { baseMs?: number; maxMs?: number }
}

export interface WsClient {
  readonly status: WsStatus
  /** Send a message, or queue it if the socket isn't open yet. */
  send(message: ClientMessage): void
  /** Close permanently (no reconnect). */
  close(): void
}

const SOCKET_OPEN = 1

export function createWsClient(options: WsClientOptions): WsClient {
  const Impl = options.WebSocketImpl ?? (WebSocket as unknown as WebSocketCtor)
  const baseMs = options.reconnect?.baseMs ?? 500
  const maxMs = options.reconnect?.maxMs ?? 10_000

  let socket: WebSocketLike | null = null
  let status: WsStatus = 'closed'
  let attempts = 0
  let manualClose = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const outbox: string[] = []

  function setStatus(next: WsStatus): void {
    if (status === next) return
    status = next
    options.onStatusChange?.(next)
  }

  function connect(): void {
    setStatus('connecting')
    const sock = new Impl(options.url)
    socket = sock
    sock.onopen = () => {
      attempts = 0
      setStatus('open')
      for (const data of outbox.splice(0)) sock.send(data)
    }
    sock.onmessage = (event) => {
      let parsed: ServerMessage
      try {
        parsed = JSON.parse(String(event.data)) as ServerMessage
      } catch {
        return // ignore malformed frames
      }
      options.onMessage(parsed)
    }
    sock.onclose = () => {
      socket = null
      setStatus('closed')
      if (!manualClose) scheduleReconnect()
    }
    // onerror is followed by onclose, which drives reconnection; nothing extra to do here.
    sock.onerror = () => {}
  }

  function scheduleReconnect(): void {
    const delay = Math.min(maxMs, baseMs * 2 ** attempts)
    attempts++
    reconnectTimer = setTimeout(connect, delay)
  }

  connect()

  return {
    get status() {
      return status
    },
    send(message) {
      const data = JSON.stringify(message)
      if (socket && socket.readyState === SOCKET_OPEN) socket.send(data)
      else outbox.push(data)
    },
    close() {
      manualClose = true
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      socket?.close()
      setStatus('closed')
    },
  }
}
