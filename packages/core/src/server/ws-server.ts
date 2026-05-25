// A standalone WebSocket server for the Shiage protocol, framework-agnostic so both the Vite and
// Next plugins reuse it (rather than each owning a 6th package's worth of socket plumbing). It runs
// independently of the dev server's own HTTP server — a free port via `port: 0` — and speaks
// newline-free JSON frames. It is a dumb transport: parsing a frame to a ClientMessage and routing
// it is the caller's job (they pass `onMessage`, typically wireProtocol's handler).
import { WebSocketServer, WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { ClientMessage, ServerMessage } from '../protocol'

/** A single connected runtime client. `send` frames a ServerMessage as JSON (no-op if not open). */
export interface WsConnection {
  send(message: ServerMessage): void
}

export interface WsServerHandle {
  /** The bound port (resolved from the OS when `port: 0` was requested). */
  readonly port: number
  /** Send a message to every currently-open client (used for `config-reloaded`). */
  broadcast(message: ServerMessage): void
  /** Terminate all clients and stop listening; resolves once the server is fully closed. */
  close(): Promise<void>
}

export interface StartWsServerOptions {
  /** Port to bind; 0 (default) lets the OS pick a free one. */
  port?: number
  /** Interface to bind; defaults to localhost (dev-only, never exposed off the machine). */
  host?: string
  /** Handle one parsed client message on the connection it arrived on. */
  onMessage(message: ClientMessage, connection: WsConnection): void
  /** Called once per new connection — e.g. to send `server-info` proactively. */
  onConnection?(connection: WsConnection): void
}

/**
 * Start the protocol WebSocket server. Resolves once it is listening (with the bound port); rejects
 * if it fails to bind. Malformed frames are dropped silently rather than tearing down the socket.
 */
export function startWsServer(options: StartWsServerOptions): Promise<WsServerHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: options.port ?? 0, host: options.host ?? 'localhost' })
    let started = false

    // Pre-`listening` errors (e.g. EADDRINUSE) fail startup; later ones are kept off the floor by
    // this same listener so the EventEmitter never throws an unhandled 'error'.
    wss.on('error', (err) => {
      if (!started) reject(err)
    })

    wss.on('connection', (socket) => {
      const connection: WsConnection = {
        send(message) {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
        },
      }
      options.onConnection?.(connection)
      socket.on('message', (data) => {
        let parsed: ClientMessage
        try {
          parsed = JSON.parse(data.toString()) as ClientMessage
        } catch {
          return // ignore non-JSON / truncated frames
        }
        options.onMessage(parsed, connection)
      })
    })

    wss.on('listening', () => {
      started = true
      const port = (wss.address() as AddressInfo).port
      resolve({
        port,
        broadcast(message) {
          const data = JSON.stringify(message)
          for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) client.send(data)
          }
        },
        close() {
          return new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate()
            wss.close(() => done())
          })
        },
      })
    })
  })
}
