// The orchestrator: mounts the overlay and drives the ambient-tracking state machine, wiring the
// panel, watch-manager, and WS client together. Kept separate from the IIFE entry (index.ts) so
// it can be imported and driven in tests without auto-running.
//
// Mounting is idempotent via `window.__SHIAGE__` so a dev-server HMR re-injection of the runtime
// doesn't stack overlays. There is no "picked element" — the watch manager auto-tracks every
// stamped element in the document, the panel shows their accumulated changes grouped by element,
// and the user excludes any spurious ones before saving the whole batch.
import { OVERLAY_CSS } from './overlay/styles'
import { createPanel, type Panel, type ReviewElement } from './overlay/panel'
import { createWatchManager, type WatchManager } from './watcher/watch-manager'
import { createWsClient, type WsClient, type WebSocketLike } from './client/ws-client'
import { PROTOCOL_VERSION, type ServerMessage } from '@shiage/core/protocol'

/** Bumped independently of the protocol; sent in `hello`. */
export const RUNTIME_VERSION = '0.1.0'

const HOST_ATTR = 'data-shiage-host'

export interface ShiageInstance {
  unmount(): void
  /** The overlay's (closed) shadow root — exposed for tests. */
  readonly shadow: ShadowRoot
  /** The panel controller — exposed for tests. */
  readonly panel: Panel
  /** The watch manager — exposed for tests so a test can drive `sync()` synchronously. */
  readonly manager: WatchManager
}

declare global {
  interface Window {
    __SHIAGE__?: ShiageInstance
  }
}

export interface MountOptions {
  /** WS server URL. Defaults to `<meta name="shiage-ws-port">` + the page host. */
  wsUrl?: string
  /** WebSocket constructor (tests). */
  WebSocketImpl?: new (url: string) => WebSocketLike
  /** Connect to the dev server. Default true; pass false in tests to skip networking. */
  autoConnect?: boolean
  /** saveId generator (tests). Defaults to a random id. */
  genSaveId?: () => string
}

function resolveWsUrl(explicit?: string): string | null {
  if (explicit) return explicit
  const port = document.querySelector('meta[name="shiage-ws-port"]')?.getAttribute('content')
  if (!port) return null
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.hostname || 'localhost'}:${port}`
}

export function mount(options: MountOptions = {}): ShiageInstance {
  if (window.__SHIAGE__) return window.__SHIAGE__

  // ── Shadow host: an unstyled anchor; the overlay floats from a closed shadow root so the page's
  // CSS (Tailwind preflight, resets) can neither style it nor read into it. ──
  const host = document.createElement('div')
  host.setAttribute(HOST_ATTR, '')
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = OVERLAY_CSS
  shadow.appendChild(style)

  // ── Orchestrator state: the user's per-source-loc exclusion choices. Keyed by `data-shiage-loc`
  // so a checkbox the user unticked survives an HMR re-render of the same source site. ──
  const excludedElements = new Set<string>()
  const excludedProps = new Map<string, Set<string>>()
  let currentSaveId: string | null = null

  const genSaveId =
    options.genSaveId ??
    (() =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2))

  const panel = createPanel(shadow, {
    onSave: doSave,
    onConfirm: doConfirm,
    onCancel: dismiss,
    onToggleElement: toggleElement,
    onToggleProperty: toggleProperty,
  })

  // Build the current `tracking` view by joining live manager state with the user's exclusion
  // sets. Called any time something that could change the view does — a tracker update, a toggle,
  // a successful apply.
  function renderTracking(): void {
    const all = manager.getAllChanges()
    const elements: ReviewElement[] = all.map((e) => ({
      sourceLoc: e.sourceLoc,
      tagName: e.element.tagName,
      changes: e.changes,
      excluded: excludedElements.has(e.sourceLoc),
      excludedProps: excludedProps.get(e.sourceLoc) ?? new Set<string>(),
    }))
    let includedCount = 0
    for (const re of elements) {
      if (re.excluded) continue
      for (const c of re.changes) if (!re.excludedProps.has(c.property)) includedCount += 1
    }
    panel.render({ kind: 'tracking', elements, includedCount })
  }

  function doSave(): void {
    if (!ws) return
    const edits = manager
      .getAllChanges()
      .filter((e) => !excludedElements.has(e.sourceLoc))
      .map((e) => ({
        sourceLoc: e.sourceLoc,
        className: e.className,
        changes: e.changes.filter(
          (c) => !(excludedProps.get(e.sourceLoc)?.has(c.property) ?? false),
        ),
      }))
      .filter((e) => e.changes.length > 0)
    if (edits.length === 0) return
    currentSaveId = genSaveId()
    const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    ws.send({ type: 'save', saveId: currentSaveId, edits, rootFontSizePx })
    panel.render({ kind: 'saving' })
  }

  function doConfirm(): void {
    if (!ws || !currentSaveId) return
    ws.send({ type: 'apply', saveId: currentSaveId })
    panel.render({ kind: 'saving' })
  }

  function dismiss(): void {
    if (ws && currentSaveId) ws.send({ type: 'cancel', saveId: currentSaveId })
    currentSaveId = null
    renderTracking()
  }

  function toggleElement(sourceLoc: string, excluded: boolean): void {
    if (excluded) excludedElements.add(sourceLoc)
    else excludedElements.delete(sourceLoc)
    renderTracking()
  }

  function toggleProperty(sourceLoc: string, property: string, excluded: boolean): void {
    const set = excludedProps.get(sourceLoc) ?? new Set<string>()
    if (excluded) set.add(property)
    else set.delete(property)
    if (set.size === 0) excludedProps.delete(sourceLoc)
    else excludedProps.set(sourceLoc, set)
    renderTracking()
  }

  function onMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'server-info':
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          console.warn(
            `[shiage] protocol mismatch: runtime ${PROTOCOL_VERSION}, server ${message.protocolVersion}`,
          )
        }
        break
      case 'diff-preview':
        if (message.saveId !== currentSaveId) return
        panel.render({
          kind: 'preview',
          diffs: message.diffs,
          warnings: message.warnings,
          unsupported: message.unsupported,
        })
        break
      case 'no-edit':
        if (message.saveId !== currentSaveId) return
        panel.render({ kind: 'no-edit', reason: message.reason })
        break
      case 'apply-result':
        if (message.saveId !== currentSaveId) return
        currentSaveId = null
        if (message.success) {
          // Everything written is the new baseline; the user's per-loc exclusion choices are spent.
          manager.rebaseline()
          excludedElements.clear()
          excludedProps.clear()
          panel.render({ kind: 'applied' })
        } else {
          panel.render({ kind: 'error', message: message.error ?? 'Failed to write the files.' })
        }
        break
      case 'config-reloaded':
        // The theme changed; the elements' current computed styles are still valid, so baselines
        // stand. Nothing to do for now.
        break
    }
  }

  // ── The watch manager: discovers stamped elements at construction (silently) and re-syncs on
  // every DOM mutation. `onChange` is debounced naturally because the manager fires it at most
  // once per tick of its shared poll / per MutationObserver batch. ──
  const manager = createWatchManager({ onChange: renderTracking })

  // ── WS client ──
  let ws: WsClient | null = null
  const wsUrl = resolveWsUrl(options.wsUrl)
  if ((options.autoConnect ?? true) && wsUrl) {
    ws = createWsClient({
      url: wsUrl,
      WebSocketImpl: options.WebSocketImpl,
      onMessage,
      onStatusChange: (status) => {
        panel.setConnection(status)
        if (status === 'open') {
          ws?.send({
            type: 'hello',
            runtimeVersion: RUNTIME_VERSION,
            protocolVersion: PROTOCOL_VERSION,
          })
        }
      },
    })
  } else {
    panel.setConnection('closed')
  }

  function unmount(): void {
    manager.stop()
    ws?.close()
    panel.destroy()
    host.remove()
    delete window.__SHIAGE__
  }

  const instance: ShiageInstance = { unmount, shadow, panel, manager }
  window.__SHIAGE__ = instance

  // Initial render — empty if no stamped elements yet, otherwise reflects whatever the manager
  // discovered on construction. No sessionStorage re-pick needed: the manager auto-discovers.
  renderTracking()

  return instance
}
