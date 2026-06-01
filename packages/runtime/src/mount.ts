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
import { PROTOCOL_VERSION, type PropertyChange, type ServerMessage } from '@shiage/core/protocol'

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

  // ── Visual preview / revert layer ──
  // When the user excludes a change (per-prop, per-element, or via Remove), Shiage doesn't just
  // hide it from the next save — it visually reverts that property on the element by writing an
  // `!important` inline override at the baseline value. That lets the panel double as a live
  // "what would the page look like if I included this change vs. not?" toggle.
  //
  // Architectural wrinkle: the element-tracker's `confirmed` set auto-clears the moment computed
  // value returns to baseline (see element-tracker.ts:88-107). So once we apply an override the
  // tracker silently forgets the change. To keep rendering the struck row in the panel anyway, we
  // remember the PropertyChange in a parallel `snapshots` map keyed by loc → property.
  //
  // Holds carry an `origin`:
  //   - 'excluded' — driven by the per-prop / per-element checkbox; release semantics follow the
  //      checkbox state (reconcile re-derives whether the hold should still exist from
  //      excludedElements + excludedProps).
  //   - 'remove' — driven by the per-group Remove button. Sticky until a successful apply (see
  //      apply-result handler). No snapshot is captured, so the panel group disappears entirely
  //      — Remove is the destructive "wipe this element from my preview" affordance, distinct
  //      from per-row uncheck which keeps the row alive for re-checking.
  //
  // `originalInline` is what was on `element.style` for the property *before* we applied the
  // override. On release, restoring it gives the user back their inline DevTools edit (if any) or
  // clears our override outright (if the DevTools edit was a stylesheet rule, not inline).
  type HoldOrigin = 'excluded' | 'remove'
  interface Hold {
    oldValue: string
    originalInline: { value: string; priority: string } | null
    origin: HoldOrigin
  }
  interface LocOverlay {
    element: Element
    tagName: string
    holds: Map<string, Hold>
    snapshots: Map<string, PropertyChange>
  }
  const overlays = new Map<string, LocOverlay>()

  // The edits we last shipped to the server, captured at `doSave` and consulted on
  // `apply-result` success so we can `removeProperty` any inline override that would otherwise
  // shadow HMR's repaint with the new Tailwind class.
  let inflightEdits: { sourceLoc: string; element: Element; properties: Set<string> }[] = []

  // Per-loc, the order in which properties first appeared in this session. Used at render time to
  // keep row positions stable: without this, unticking a property would let it auto-clear from the
  // tracker, fall out of `getAllChanges()`, and re-enter the merged view from the snapshot loop
  // *after* whatever live rows came after it — visually shuffling the panel. Insertion is sticky;
  // we never prune entries mid-session, only on apply-success (along with the rest of the state).
  const propertyOrders = new Map<string, string[]>()

  function getOrCreateOverlay(loc: string, element: Element, tagName: string): LocOverlay {
    const existing = overlays.get(loc)
    if (existing) {
      // Refresh element + tag in case HMR re-stamped the same loc with a fresh node.
      existing.element = element
      existing.tagName = tagName
      return existing
    }
    const created: LocOverlay = {
      element,
      tagName,
      holds: new Map(),
      snapshots: new Map(),
    }
    overlays.set(loc, created)
    return created
  }

  function pruneOverlay(loc: string): void {
    const overlay = overlays.get(loc)
    if (overlay && overlay.holds.size === 0 && overlay.snapshots.size === 0) overlays.delete(loc)
  }

  function applyHold(
    overlay: LocOverlay,
    property: string,
    oldValue: string,
    origin: HoldOrigin,
  ): void {
    // Idempotent: a property already held keeps its original-inline capture (the very first one),
    // so a later release restores the user's pre-Shiage state — not some intermediate state we
    // wrote on the second hold. Caller wanting to upgrade origin should release first.
    if (overlay.holds.has(property)) return
    const style = (overlay.element as HTMLElement).style
    const current = style.getPropertyValue(property)
    const originalInline =
      current === '' ? null : { value: current, priority: style.getPropertyPriority(property) }
    style.setProperty(property, oldValue, 'important')
    overlay.holds.set(property, { oldValue, originalInline, origin })
  }

  function releaseHold(overlay: LocOverlay, property: string): void {
    const hold = overlay.holds.get(property)
    if (!hold) return
    const style = (overlay.element as HTMLElement).style
    if (hold.originalInline === null) {
      style.removeProperty(property)
    } else {
      style.setProperty(property, hold.originalInline.value, hold.originalInline.priority)
    }
    overlay.holds.delete(property)
    overlay.snapshots.delete(property)
  }

  // Re-pin any held property whose inline value has drifted (host-app or HMR write that cleared
  // our override). Runs after every renderTracking; cheap because `overlays` is small and each
  // check bails when in sync.
  function reapplyHolds(): void {
    for (const overlay of overlays.values()) {
      if (!overlay.element.isConnected) continue
      const style = (overlay.element as HTMLElement).style
      for (const [property, hold] of overlay.holds) {
        if (
          style.getPropertyValue(property) !== hold.oldValue ||
          style.getPropertyPriority(property) !== 'important'
        ) {
          style.setProperty(property, hold.oldValue, 'important')
        }
      }
    }
  }

  // Bring excluded-origin holds in line with the current excludedElements/excludedProps intent.
  // Idempotent — safe to call after every state mutation that could change the predicate.
  // Remove-origin holds are untouched; they survive until apply-result success.
  function reconcileExcludedHolds(): void {
    // (1) For every live change whose predicate says "should be held", make sure it is.
    //     Snapshots are captured here from the live PropertyChange so the panel can keep
    //     rendering the row after the tracker auto-clears.
    for (const e of manager.getAllChanges()) {
      const elementExcluded = excludedElements.has(e.sourceLoc)
      const propSet = excludedProps.get(e.sourceLoc)
      if (!elementExcluded && (propSet === undefined || propSet.size === 0)) continue
      for (const change of e.changes) {
        const shouldHold = elementExcluded || (propSet?.has(change.property) ?? false)
        if (!shouldHold) continue
        const overlay = getOrCreateOverlay(e.sourceLoc, e.element, e.element.tagName)
        if (!overlay.holds.has(change.property)) {
          applyHold(overlay, change.property, change.oldValue, 'excluded')
          overlay.snapshots.set(change.property, change)
        }
      }
    }
    // (2) Release excluded-origin holds whose predicate is no longer true. We iterate overlays
    //     because the held property may already have auto-cleared from `getAllChanges`.
    for (const [loc, overlay] of [...overlays]) {
      const elementExcluded = excludedElements.has(loc)
      const propSet = excludedProps.get(loc)
      for (const [property, hold] of [...overlay.holds]) {
        if (hold.origin !== 'excluded') continue
        const shouldHold = elementExcluded || (propSet?.has(property) ?? false)
        if (!shouldHold) releaseHold(overlay, property)
      }
      pruneOverlay(loc)
    }
  }

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
    onRemoveElement: removeElement,
  })

  // Build the current `tracking` view by joining live manager state with the user's exclusion
  // sets and any snapshot entries kept alive by the hold layer. Called any time something that
  // could change the view does — a tracker update, a toggle, Remove, a successful apply.
  //
  // The merged shape: for each loc that has either live changes or snapshots, we emit ONE
  // ReviewElement. `changes` is the union of live + snapshot PropertyChanges (live wins on
  // conflict), ordered by each property's first-seen position in `propertyOrders[loc]` so a
  // checkbox toggle never reshuffles the rows. `excludedProps` carries both the user-intent
  // exclusions AND reset-origin holds, so reset-held rows render struck + unchecked even though
  // they're not in user-intent excludedProps. `includedCount` only counts live, non-excluded
  // properties — what would actually ship in a save.
  function renderTracking(): void {
    // Index live state by loc / property for cheap lookup; we walk the order list, not these maps.
    const liveByLoc = new Map<string, { element: Element; tagName: string }>()
    const liveProps = new Map<string, Map<string, PropertyChange>>()
    for (const e of manager.getAllChanges()) {
      liveByLoc.set(e.sourceLoc, { element: e.element, tagName: e.element.tagName })
      const map = new Map<string, PropertyChange>()
      for (const c of e.changes) map.set(c.property, c)
      liveProps.set(e.sourceLoc, map)
    }

    // Refresh `propertyOrders`: append any newly-seen properties for each loc (live first, then
    // snapshot) in their natural arrival order. Existing positions stick.
    const locs = new Set<string>([...liveByLoc.keys(), ...overlays.keys()])
    for (const loc of locs) {
      const order = propertyOrders.get(loc) ?? []
      const seen = new Set(order)
      const liveMap = liveProps.get(loc)
      if (liveMap) {
        for (const prop of liveMap.keys()) {
          if (!seen.has(prop)) {
            order.push(prop)
            seen.add(prop)
          }
        }
      }
      const overlay = overlays.get(loc)
      if (overlay) {
        for (const prop of overlay.snapshots.keys()) {
          if (!seen.has(prop)) {
            order.push(prop)
            seen.add(prop)
          }
        }
      }
      if (order.length > 0) propertyOrders.set(loc, order)
    }

    const elements: ReviewElement[] = []
    for (const loc of locs) {
      const order = propertyOrders.get(loc) ?? []
      const liveMap = liveProps.get(loc) ?? new Map<string, PropertyChange>()
      const overlay = overlays.get(loc)
      const snaps = overlay?.snapshots ?? new Map<string, PropertyChange>()
      // Walk the sticky order and pull each property's current PropertyChange — live wins, snapshot
      // covers the auto-cleared case, otherwise we drop the entry (property gone from both sides).
      const changes: PropertyChange[] = []
      for (const prop of order) {
        const c = liveMap.get(prop) ?? snaps.get(prop)
        if (c) changes.push(c)
      }
      if (changes.length === 0) continue

      const intent = excludedProps.get(loc) ?? new Set<string>()
      const displayed = new Set(intent)
      // Defensive: a Remove-origin hold normally has no snapshot (Remove drops the group entirely),
      // so this loop is a no-op in steady state. Kept for the corner case where a Remove follows an
      // already-snapshotted exclusion on the same property — the snapshot survives the rename and
      // its row should still render as struck.
      if (overlay) {
        for (const [property, hold] of overlay.holds) {
          if (hold.origin === 'remove') displayed.add(property)
        }
      }
      const tagName = liveByLoc.get(loc)?.tagName ?? overlay?.tagName ?? ''
      elements.push({
        sourceLoc: loc,
        tagName,
        changes,
        excluded: excludedElements.has(loc),
        excludedProps: displayed,
      })
    }

    let includedCount = 0
    for (const re of elements) {
      if (re.excluded) continue
      const overlay = overlays.get(re.sourceLoc)
      for (const c of re.changes) {
        // A change ships in the save iff: not per-prop excluded, AND not snapshot-only (i.e.
        // the tracker is reporting it live). Snapshot-only props are visualized but not sent.
        if (re.excludedProps.has(c.property)) continue
        if (overlay?.snapshots.has(c.property)) continue
        includedCount += 1
      }
    }
    panel.render({ kind: 'tracking', elements, includedCount })
    reapplyHolds()
  }

  function doSave(): void {
    if (!ws) return
    inflightEdits = []
    const edits = manager
      .getAllChanges()
      .filter((e) => !excludedElements.has(e.sourceLoc))
      .map((e) => {
        const changes = e.changes.filter(
          (c) => !(excludedProps.get(e.sourceLoc)?.has(c.property) ?? false),
        )
        return { entry: e, changes }
      })
      .filter(({ changes }) => changes.length > 0)
      .map(({ entry, changes }) => {
        // Capture the live element + property set so apply-result success can `removeProperty`
        // any inline hold that would shadow HMR repaint of the saved Tailwind class.
        inflightEdits.push({
          sourceLoc: entry.sourceLoc,
          element: entry.element,
          properties: new Set(changes.map((c) => c.property)),
        })
        return { sourceLoc: entry.sourceLoc, className: entry.className, changes }
      })
    if (edits.length === 0) {
      inflightEdits = []
      return
    }
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
    reconcileExcludedHolds()
    renderTracking()
  }

  function toggleProperty(sourceLoc: string, property: string, excluded: boolean): void {
    const set = excludedProps.get(sourceLoc) ?? new Set<string>()
    if (excluded) set.add(property)
    else set.delete(property)
    if (set.size === 0) excludedProps.delete(sourceLoc)
    else excludedProps.set(sourceLoc, set)

    // Re-checking a row releases *any* hold for that property, regardless of origin. The common
    // case is the per-row excluded-origin hold — release lets the tracker re-detect the change on
    // the next ingest. Remove-origin holds normally have no panel row (no snapshot was taken), so
    // this path almost never fires for them in practice, but keeping it origin-agnostic guards
    // against a corner where a snapshot survived a state transition.
    if (!excluded) {
      const overlay = overlays.get(sourceLoc)
      if (overlay?.holds.has(property)) {
        releaseHold(overlay, property)
        pruneOverlay(sourceLoc)
      }
    }
    reconcileExcludedHolds()
    renderTracking()
  }

  // Per-element remove: pin every live change to its baseline value (an inline `!important`
  // override), rebaseline the tracker so it forgets the changes, and drop the panel's local state
  // for this loc so the whole group disappears from the tracking view. The user has said "I don't
  // want any of these edits" — distinct from per-row uncheck, which keeps the row alive for
  // re-checking. The overrides stay active (sticky preview) until a successful apply releases
  // them; a Remove does NOT itself send anything to the server.
  //
  // We deliberately do NOT snapshot the changes (so the panel rendering finds nothing live and
  // nothing snapshotted for the loc → no group) and we DO clear propertyOrders[loc] so a fresh
  // edit on the same element later starts from a clean ordering.
  function removeElement(sourceLoc: string): void {
    const target = manager.getAllChanges().find((e) => e.sourceLoc === sourceLoc)
    excludedElements.delete(sourceLoc)
    excludedProps.delete(sourceLoc)
    propertyOrders.delete(sourceLoc)
    if (!target) {
      // Element is gone (HMR removed it, or it was already snapshot-only with no live changes).
      // Nothing to pin; just clean up any lingering overlay state and re-render.
      const overlay = overlays.get(sourceLoc)
      if (overlay) {
        for (const property of [...overlay.holds.keys()]) releaseHold(overlay, property)
        overlay.snapshots.clear()
        overlays.delete(sourceLoc)
      }
      renderTracking()
      return
    }
    const overlay = getOrCreateOverlay(sourceLoc, target.element, target.element.tagName)
    for (const change of target.changes) {
      applyHold(overlay, change.property, change.oldValue, 'remove')
    }
    // Drop any lingering snapshots from a prior per-row exclusion — Remove is a clean wipe.
    overlay.snapshots.clear()
    manager.rebaseline(target.element)
    // manager.rebaseline fires onChange → renderTracking, which calls reapplyHolds. No extra
    // render call needed.
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
          // Step 1: for every (loc, prop) the server wrote, removeProperty unconditionally so
          // no inline override (held or not) shadows HMR's repaint of the new Tailwind class.
          // This also takes care of any 'excluded'-origin hold that lived on a saved prop — the
          // explicit removeProperty happens before we walk the rest of `overlays` to release.
          for (const edit of inflightEdits) {
            if (!edit.element.isConnected) continue
            const style = (edit.element as HTMLElement).style
            for (const prop of edit.properties) style.removeProperty(prop)
          }
          // Step 2: release every remaining hold so the user's pre-Shiage inline state (e.g. the
          // DevTools inline edit they made for an excluded or Remove-held prop) is restored, then
          // the tracker re-detects it on the next ingest. The user gets back a clean tracking
          // view that reflects whatever DevTools edits still stand.
          for (const overlay of overlays.values()) {
            if (!overlay.element.isConnected) continue
            for (const property of [...overlay.holds.keys()]) releaseHold(overlay, property)
          }
          // Step 3: everything written is the new baseline; per-loc exclusion + preview state
          // is spent.
          overlays.clear()
          excludedElements.clear()
          excludedProps.clear()
          propertyOrders.clear()
          inflightEdits = []
          manager.rebaseline()
          panel.render({ kind: 'applied' })
        } else {
          // Failure: leave holds, snapshots, exclusions, and inflightEdits intact so the user can
          // retry from the same preview state.
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
  // once per tick of its shared poll / per MutationObserver batch. `settleMs` absorbs the
  // layout/style-load deltas that show up if a tracker is created mid-render (initial mount, but
  // also each HMR-injected stamped element) — ~2 frames is the conventional "layout settled"
  // budget; any actual user edit during that window is preserved (the rebaseline is skipped if
  // the tracker already saw a confirmed change). ──
  const manager = createWatchManager({ onChange: renderTracking, settleMs: 32 })

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
