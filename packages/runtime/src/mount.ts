// The orchestrator: mounts the overlay and drives the pick → edit → save → review → apply state
// machine, wiring the panel, picker, watcher, and WS client together. Kept separate from the IIFE
// entry (index.ts) so it can be imported and driven in tests without auto-running.
//
// Mounting is idempotent via `window.__SHIAGE__` so a dev-server HMR re-injection of the runtime
// doesn't stack overlays; the picked element's source location is stashed in sessionStorage so a
// full-reload HMR can re-select it and resume watching.
import { OVERLAY_CSS } from './overlay/styles'
import { createPanel, type Panel } from './overlay/panel'
import { startPicking, type PickResult } from './picker/picker'
import { createHighlight } from './picker/highlight'
import { createWatcher, type Watcher } from './watcher/watcher'
import { createWsClient, type WsClient, type WebSocketLike } from './client/ws-client'
import { PROTOCOL_VERSION, type ServerMessage } from '@shiage/core/protocol'

/** Bumped independently of the protocol; sent in `hello`. */
export const RUNTIME_VERSION = '0.1.0'

const HOST_ATTR = 'data-shiage-host'
const PICKED_LOC_KEY = 'shiage:picked-loc'

export interface ShiageInstance {
  unmount(): void
  /** The overlay's (closed) shadow root — exposed for tests. */
  readonly shadow: ShadowRoot
  /** The panel controller — exposed for tests. */
  readonly panel: Panel
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

  const highlight = createHighlight(shadow)

  // ── Orchestrator state ──
  let pickedElement: Element | null = null
  let pickedLoc: string | null = null
  let watcher: Watcher | null = null
  let stopPick: (() => void) | null = null
  let currentSaveId: string | null = null

  const genSaveId =
    options.genSaveId ??
    (() =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2))

  const panel = createPanel(shadow, {
    onPick: enterPickMode,
    onSave: doSave,
    onConfirm: doConfirm,
    onCancel: dismiss,
  })

  function renderPickedOrIdle(): void {
    if (pickedElement) {
      panel.render({
        kind: 'picked',
        tagName: pickedElement.tagName,
        sourceLoc: pickedLoc,
        changeCount: watcher?.getCurrentChanges().length ?? 0,
      })
    } else {
      panel.render({ kind: 'idle' })
    }
  }

  function enterPickMode(): void {
    stopPick?.()
    panel.render({ kind: 'picking' })
    stopPick = startPicking({
      isOwnElement: (el) => el.closest(`[${HOST_ATTR}]`) !== null,
      onHover: (el) => (el ? highlight.show(el) : highlight.hide()),
      onPick: (result) => {
        highlight.hide()
        stopPick = null
        selectElement(result)
      },
      onCancel: () => {
        highlight.hide()
        stopPick = null
        renderPickedOrIdle()
      },
    })
  }

  function selectElement(result: PickResult): void {
    watcher?.stop()
    // Operate on the nearest stamped (host) element — the one whose className we can rewrite.
    pickedElement = result.matchedElement ?? result.element
    pickedLoc = result.sourceLoc
    if (pickedLoc) sessionStorage.setItem(PICKED_LOC_KEY, pickedLoc)
    watcher = createWatcher(pickedElement, { onChange: renderPickedOrIdle })
    renderPickedOrIdle()
  }

  function doSave(): void {
    if (!ws || !watcher || !pickedLoc || !pickedElement) return
    const changes = watcher.getCurrentChanges()
    if (changes.length === 0) return
    currentSaveId = genSaveId()
    const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    // Phase-A stopgap: the single-element picker flow sends a one-entry batch under the new
    // protocol shape. Phase C replaces this whole orchestrator with the ambient watch manager
    // and a real multi-element batch.
    ws.send({
      type: 'save',
      saveId: currentSaveId,
      edits: [
        {
          sourceLoc: pickedLoc,
          className: pickedElement.getAttribute('class') ?? '',
          changes,
        },
      ],
      rootFontSizePx,
    })
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
    renderPickedOrIdle()
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
        // Phase-A stopgap: the single-element flow shows the first (and only) diff. Phase C's
        // panel rewrite will render all `diffs` as separate file blocks. A `diff-preview` reply
        // is only sent when at least one file was staged, so `diffs[0]` is always defined here.
        panel.render({
          kind: 'review',
          diff: message.diffs[0]!,
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
          watcher?.rebaseline()
          panel.render({ kind: 'applied' })
        } else {
          panel.render({ kind: 'error', message: message.error ?? 'Failed to write the file.' })
        }
        break
      case 'config-reloaded':
        // The theme changed; the element's current computed styles are still valid, so the baseline
        // stands. Nothing to do for now.
        break
    }
  }

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
    stopPick?.()
    watcher?.stop()
    ws?.close()
    panel.destroy()
    highlight.destroy()
    host.remove()
    delete window.__SHIAGE__
  }

  const instance: ShiageInstance = { unmount, shadow, panel }
  window.__SHIAGE__ = instance

  // ── HMR full-reload survival: re-pick the previously selected element if it's still in the DOM. ──
  const savedLoc = sessionStorage.getItem(PICKED_LOC_KEY)
  if (savedLoc) {
    // The loc is `relPath:line:col` (no quotes/backslashes), but escape defensively for the
    // attribute selector rather than depend on CSS.escape (not in every environment).
    const el = document.querySelector(`[data-shiage-loc="${savedLoc.replace(/["\\]/g, '\\$&')}"]`)
    if (el) {
      selectElement({ element: el, matchedElement: el, sourceLoc: savedLoc })
    } else {
      sessionStorage.removeItem(PICKED_LOC_KEY)
      renderPickedOrIdle()
    }
  } else {
    renderPickedOrIdle()
  }

  return instance
}
