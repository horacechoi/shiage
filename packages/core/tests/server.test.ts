// End-to-end of the Node half of the save flow, without a browser: a real `ws` client connects to
// a real startWsServer + wireProtocol, driven against the real v4 fixture theme and one or more
// temp TSX files on disk. This is verification-strategy layer 3 — it proves map → edit → diff →
// write works over the wire across single-element saves, same-file batches (the no-clobber
// correctness crux), multi-file batches, and per-element failure modes, leaving only the in-browser
// DevTools UI to the manual checklist.
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

  /** Stand up a fresh temp project + server. `files` are written under `tempDir` verbatim. */
  async function bootFiles(files: { name: string; code: string }[]): Promise<void> {
    tempDir = mkdtempSync(path.join(tmpdir(), 'shiage-server-'))
    for (const f of files) writeFileSync(path.join(tempDir, f.name), f.code, 'utf8')

    const handler = wireProtocol(() => ({ projectRoot: tempDir, themeSource, lookup }))
    server = await startWsServer({
      onMessage: (message, conn) => handler.handle(message, conn.send),
    })

    client = new TestClient(server.port)
    await client.ready()
  }

  /** Convenience for the single-element cases: wrap one element line in a fresh `App.tsx`. */
  async function boot(elementLine: string): Promise<{ sourceLoc: string }> {
    const code = `export function App() {\n  return ${elementLine}\n}\n`
    await bootFiles([{ name: 'App.tsx', code }])
    const loc = stampLocOf(code, tagOf(elementLine))
    return { sourceLoc: `App.tsx:${loc.line}:${loc.column}` }
  }

  it('answers hello with server-info carrying the protocol version', async () => {
    await boot('<div className="pl-4">hi</div>')
    client.send({ type: 'hello', runtimeVersion: '0.1.0', protocolVersion: 2 })
    const reply = await client.next()
    expect(reply).toEqual({ type: 'server-info', protocolVersion: 2 })
  })

  it('previews a one-element save as a class edit, then applies it to disk on confirm', async () => {
    const { sourceLoc } = await boot('<div className="pl-4">hi</div>')

    client.send({
      type: 'save',
      saveId: 's1',
      edits: [
        {
          sourceLoc,
          className: 'pl-4',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
        },
      ],
      rootFontSizePx: 16,
    })

    const preview = await client.next()
    expect(preview.type).toBe('diff-preview')
    if (preview.type !== 'diff-preview') throw new Error('expected diff-preview')
    expect(preview.saveId).toBe('s1')
    expect(preview.diffs).toHaveLength(1)
    expect(preview.diffs[0]!.filePath).toBe('App.tsx')
    const text = preview.diffs[0]!.hunks.flatMap((h) => h.lines).map((l) => `${l.kind}:${l.text}`)
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

  // The correctness crux for batching: two elements in the same file MUST both survive the apply.
  // Without threading the rewritten code between successive editJsxSource calls, the second edit
  // is computed against the original text and clobbers the first when staged — this test catches
  // exactly that regression.
  it('threads same-file edits so two elements in one file both survive (no clobber)', async () => {
    const code = `export function App() {
  return (
    <div>
      <span className="pl-2">a</span>
      <button className="pl-4">b</button>
    </div>
  )
}
`
    await bootFiles([{ name: 'App.tsx', code }])
    const spanLoc = stampLocOf(code, 'span')
    const buttonLoc = stampLocOf(code, 'button')

    client.send({
      type: 'save',
      saveId: 's-thread',
      edits: [
        {
          sourceLoc: `App.tsx:${spanLoc.line}:${spanLoc.column}`,
          className: 'pl-2',
          changes: [{ property: 'padding-left', oldValue: '8px', newValue: '16px' }],
        },
        {
          sourceLoc: `App.tsx:${buttonLoc.line}:${buttonLoc.column}`,
          className: 'pl-4',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
        },
      ],
      rootFontSizePx: 16,
    })

    const preview = await client.next()
    expect(preview.type).toBe('diff-preview')
    if (preview.type !== 'diff-preview') throw new Error('expected diff-preview')
    expect(preview.diffs).toHaveLength(1) // same file → one diff, multiple hunks
    expect(preview.diffs[0]!.filePath).toBe('App.tsx')

    client.send({ type: 'apply', saveId: 's-thread' })
    const result = await client.next()
    expect(result).toEqual({ type: 'apply-result', saveId: 's-thread', success: true })

    // Both elements rewritten — the threading guarantee.
    const written = readFileSync(path.join(tempDir, 'App.tsx'), 'utf8')
    expect(written).toContain('<span className="pl-4"')
    expect(written).toContain('<button className="pl-6"')
    expect(written).not.toContain('<span className="pl-2"')
    expect(written).not.toContain('<button className="pl-4"')
  })

  it('returns one diff per file when a batch spans multiple files', async () => {
    const aCode = `export function A() {\n  return <div className="pl-4">a</div>\n}\n`
    const bCode = `export function B() {\n  return <span className="pl-2">b</span>\n}\n`
    await bootFiles([
      { name: 'A.tsx', code: aCode },
      { name: 'B.tsx', code: bCode },
    ])
    const aLoc = stampLocOf(aCode, 'div')
    const bLoc = stampLocOf(bCode, 'span')

    client.send({
      type: 'save',
      saveId: 's-multi',
      edits: [
        {
          sourceLoc: `A.tsx:${aLoc.line}:${aLoc.column}`,
          className: 'pl-4',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
        },
        {
          sourceLoc: `B.tsx:${bLoc.line}:${bLoc.column}`,
          className: 'pl-2',
          changes: [{ property: 'padding-left', oldValue: '8px', newValue: '16px' }],
        },
      ],
      rootFontSizePx: 16,
    })

    const preview = await client.next()
    expect(preview.type).toBe('diff-preview')
    if (preview.type !== 'diff-preview') throw new Error('expected diff-preview')
    expect(preview.diffs).toHaveLength(2)
    expect(preview.diffs.map((d) => d.filePath).sort()).toEqual(['A.tsx', 'B.tsx'])

    client.send({ type: 'apply', saveId: 's-multi' })
    const result = await client.next()
    expect(result).toEqual({ type: 'apply-result', saveId: 's-multi', success: true })
    expect(readFileSync(path.join(tempDir, 'A.tsx'), 'utf8')).toContain('pl-6')
    expect(readFileSync(path.join(tempDir, 'B.tsx'), 'utf8')).toContain('pl-4')
  })

  it('skips a failed element with a warning and still previews the rest of the batch', async () => {
    const { sourceLoc } = await boot('<div className="pl-4">hi</div>')

    client.send({
      type: 'save',
      saveId: 's-skip',
      edits: [
        {
          sourceLoc: 'App.tsx:999:3', // no element at this location
          className: 'pl-4',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
        },
        {
          sourceLoc,
          className: 'pl-4',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
        },
      ],
      rootFontSizePx: 16,
    })

    const preview = await client.next()
    expect(preview.type).toBe('diff-preview') // NOT no-edit — the batch carries on
    if (preview.type !== 'diff-preview') throw new Error('expected diff-preview')
    expect(preview.diffs).toHaveLength(1)
    expect(preview.warnings.some((w) => /999:3/.test(w))).toBe(true)

    client.send({ type: 'apply', saveId: 's-skip' })
    const result = await client.next()
    expect(result).toEqual({ type: 'apply-result', saveId: 's-skip', success: true })
    expect(readFileSync(path.join(tempDir, 'App.tsx'), 'utf8')).toContain('pl-6')
  })

  it('replies no-edit when the only element in the batch is not at the given location', async () => {
    await boot('<div className="pl-4">hi</div>')
    client.send({
      type: 'save',
      saveId: 's2',
      edits: [
        {
          sourceLoc: 'App.tsx:999:3',
          className: 'pl-4',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
        },
      ],
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
      edits: [{ sourceLoc, className: 'pl-4', changes: [] }],
      rootFontSizePx: 16,
    })
    const reply = await client.next()
    expect(reply.type).toBe('no-edit')
  })

  it('drops a staged batch on cancel, so a later apply finds nothing to write', async () => {
    const { sourceLoc } = await boot('<div className="pl-4">hi</div>')
    client.send({
      type: 'save',
      saveId: 's4',
      edits: [
        {
          sourceLoc,
          className: 'pl-4',
          changes: [{ property: 'padding-left', oldValue: '16px', newValue: '24px' }],
        },
      ],
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
