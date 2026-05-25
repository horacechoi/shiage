// End-to-end of the Node half of the save flow, without a browser: a real `ws` client connects to
// a real startWsServer + wireProtocol, driven against the real v4 fixture theme and a temp TSX
// file on disk. This is verification-strategy layer 3 — it proves map → edit → diff → write works
// over the wire, leaving only the in-browser DevTools UI to the manual checklist.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import { createV4ThemeSource } from '../src/tailwind/v4'
import { buildReverseLookup, type ReverseLookup } from '../src/tailwind/reverse-lookup'
import type { ThemeSource } from '../src/tailwind/types'
import { startWsServer, type WsServerHandle } from '../src/server/ws-server'
import { wireProtocol } from '../src/server/protocol'
import type { ClientMessage, ServerMessage } from '../src/protocol'
import { stampLocOf } from './_jsx-helpers'

const cssEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/tailwind-v4/src/app.css',
)

/** A test WebSocket client that lets us await server frames one at a time, in order. */
class TestClient {
  private socket: WebSocket
  private queue: ServerMessage[] = []
  private waiters: ((message: ServerMessage) => void)[] = []

  constructor(port: number) {
    this.socket = new WebSocket(`ws://localhost:${port}`)
    this.socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage
      const waiter = this.waiters.shift()
      if (waiter) waiter(message)
      else this.queue.push(message)
    })
  }

  ready(): Promise<void> {
    return new Promise((resolve) => this.socket.once('open', () => resolve()))
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message))
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  close(): void {
    this.socket.close()
  }
}

describe('WS protocol server (real ws client ↔ wireProtocol ↔ v4 fixture)', () => {
  let themeSource: ThemeSource
  let lookup: ReverseLookup
  let tempDir: string
  let server: WsServerHandle
  let client: TestClient

  beforeAll(async () => {
    themeSource = await createV4ThemeSource(cssEntry)
    lookup = buildReverseLookup(themeSource)
  })

  afterEach(() => {
    client.close()
    void server.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // Stand up a fresh temp project + server with `App.tsx` containing the given element source.
  async function boot(elementLine: string): Promise<{ sourceLoc: string }> {
    tempDir = mkdtempSync(path.join(tmpdir(), 'shiage-server-'))
    const code = `export function App() {\n  return ${elementLine}\n}\n`
    writeFileSync(path.join(tempDir, 'App.tsx'), code, 'utf8')

    const handler = wireProtocol(() => ({ projectRoot: tempDir, themeSource, lookup }))
    server = await startWsServer({
      onMessage: (message, conn) => handler.handle(message, conn.send),
    })

    client = new TestClient(server.port)
    await client.ready()

    // The element is on line 2 of the file (after the `export function App() {` line).
    const loc = stampLocOf(code, tagOf(elementLine))
    return { sourceLoc: `App.tsx:${loc.line}:${loc.column}` }
  }

  it('answers hello with server-info carrying the protocol version', async () => {
    await boot('<div className="pl-4">hi</div>')
    client.send({ type: 'hello', runtimeVersion: '0.1.0', protocolVersion: 1 })
    const reply = await client.next()
    expect(reply).toEqual({ type: 'server-info', protocolVersion: 1 })
  })

  it('previews a save as a class edit, then applies it to disk on confirm', async () => {
    const { sourceLoc } = await boot('<div className="pl-4">hi</div>')

    client.send({
      type: 'save',
      saveId: 's1',
      sourceLoc,
      className: 'pl-4',
      changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
      rootFontSizePx: 16,
    })

    const preview = await client.next()
    expect(preview.type).toBe('diff-preview')
    if (preview.type !== 'diff-preview') throw new Error('expected diff-preview')
    expect(preview.saveId).toBe('s1')
    expect(preview.diff.filePath).toBe('App.tsx')
    const text = preview.diff.hunks.flatMap((h) => h.lines).map((l) => `${l.kind}:${l.text}`)
    expect(text.some((t) => t.startsWith('del:') && t.includes('pl-4'))).toBe(true)
    expect(text.some((t) => t.startsWith('add:') && t.includes('pl-6'))).toBe(true)

    // Nothing is written until apply.
    expect(readFileSync(path.join(tempDir, 'App.tsx'), 'utf8')).toContain('pl-4')

    client.send({ type: 'apply', saveId: 's1' })
    const result = await client.next()
    expect(result).toEqual({ type: 'apply-result', saveId: 's1', success: true })
    const written = readFileSync(path.join(tempDir, 'App.tsx'), 'utf8')
    expect(written).toContain('pl-6')
    expect(written).not.toContain('pl-4')
  })

  it('replies no-edit when the picked element is not at the given location', async () => {
    await boot('<div className="pl-4">hi</div>')
    client.send({
      type: 'save',
      saveId: 's2',
      sourceLoc: 'App.tsx:999:3', // no element there
      className: 'pl-4',
      changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
      rootFontSizePx: 16,
    })
    const reply = await client.next()
    expect(reply.type).toBe('no-edit')
    if (reply.type === 'no-edit') expect(reply.reason).toMatch(/couldn't find/i)
  })

  it('replies no-edit when there is nothing mappable to save', async () => {
    const { sourceLoc } = await boot('<div className="pl-4">hi</div>')
    client.send({
      type: 'save',
      saveId: 's3',
      sourceLoc,
      className: 'pl-4',
      changes: [],
      rootFontSizePx: 16,
    })
    const reply = await client.next()
    expect(reply.type).toBe('no-edit')
  })

  it('drops a staged edit on cancel, so a later apply finds nothing to write', async () => {
    const { sourceLoc } = await boot('<div className="pl-4">hi</div>')
    client.send({
      type: 'save',
      saveId: 's4',
      sourceLoc,
      className: 'pl-4',
      changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
      rootFontSizePx: 16,
    })
    expect((await client.next()).type).toBe('diff-preview')

    client.send({ type: 'cancel', saveId: 's4' })
    client.send({ type: 'apply', saveId: 's4' })
    const result = await client.next()
    expect(result.type).toBe('apply-result')
    if (result.type === 'apply-result') expect(result.success).toBe(false)
    expect(readFileSync(path.join(tempDir, 'App.tsx'), 'utf8')).toContain('pl-4') // never written
  })

  it('broadcasts config-reloaded to connected clients', async () => {
    await boot('<div className="pl-4">hi</div>')
    server.broadcast({ type: 'config-reloaded' })
    expect(await client.next()).toEqual({ type: 'config-reloaded' })
  })
})

// The lowercase tag name of a single-element source line like `<div className="…">…</div>`.
function tagOf(elementLine: string): string {
  return /<([a-z][\w-]*)/.exec(elementLine)![1]!
}
