// The WebSocket message contract between the browser runtime (@shiage/runtime) and the dev-server
// plugin (@shiage/vite, @shiage/next). This module is the single source of truth for the wire
// shapes and is deliberately dependency-free and browser-safe: the runtime imports these as types
// (erased at build) plus the PROTOCOL_VERSION constant, so nothing Node-only is pulled into the
// IIFE. The plugin (Phase 5) maps `save.changes` through mapChangesToClassEdits and builds the
// SourceDiff it sends back.

/** Bumped when a wire shape changes incompatibly. Exchanged in `hello`/`server-info` so each side
 * can warn on a mismatch instead of failing cryptically. */
export const PROTOCOL_VERSION = 1

/**
 * One computed-style property the runtime observed change on the picked element. `oldValue` is the
 * value snapshotted at pick time, `newValue` the current computed value (both raw `getComputedStyle`
 * strings, e.g. `'24px'`, `'rgb(239, 68, 68)'`); the mapper normalizes them. This is the canonical
 * definition of the shape — the CSS→Tailwind mapper re-exports it.
 */
export interface PropertyChange {
  property: string
  oldValue: string
  newValue: string
}

/** A single line in a diff hunk. `kind` distinguishes added/removed/unchanged lines for rendering. */
export type DiffLine =
  | { kind: 'context'; text: string }
  | { kind: 'add'; text: string }
  | { kind: 'del'; text: string }

/** A contiguous run of changed lines with surrounding context, as produced by `diff`'s structured
 * patch. `oldStart`/`newStart` are 1-based line numbers in the before/after file. */
export interface DiffHunk {
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

/** The source-code change the server proposes for a save, ready for the runtime to render. */
export interface SourceDiff {
  /** Path shown in the diff header, relative to the project root. */
  filePath: string
  hunks: DiffHunk[]
}

// ── Client → Server ──────────────────────────────────────────────────────────

/** Sent on connect so the server can check protocol compatibility. */
export interface HelloMessage {
  type: 'hello'
  runtimeVersion: string
  protocolVersion: number
}

/** Request to turn the picked element's style changes into a proposed source edit. The server
 * stages (does not write) the edit and replies with `diff-preview` or `no-edit`. */
export interface SaveMessage {
  type: 'save'
  /** Correlates the eventual `diff-preview`/`no-edit`/`apply-result` back to this request. */
  saveId: string
  /** The picked element's stamped `data-shiage-loc`, e.g. `"src/App.tsx:42:9"`. */
  sourceLoc: string
  /** The element's current className string (what the editor merges into). */
  className: string
  changes: PropertyChange[]
  /** The live `document.documentElement` font-size in px, so the server normalizes rem against the
   * real root size rather than assuming 16. */
  rootFontSizePx: number
}

/** Confirms a previewed save; the server writes the file. */
export interface ApplyMessage {
  type: 'apply'
  saveId: string
}

/** Discards a previewed save without writing. */
export interface CancelMessage {
  type: 'cancel'
  saveId: string
}

export type ClientMessage = HelloMessage | SaveMessage | ApplyMessage | CancelMessage

// ── Server → Client ──────────────────────────────────────────────────────────

/** Sent in response to `hello`. */
export interface ServerInfoMessage {
  type: 'server-info'
  protocolVersion: number
}

/** The staged edit for a `save`, awaiting the user's confirm. `warnings` surfaces non-blocking
 * notes (e.g. color snapping); `unsupported` lists properties that couldn't be mapped. */
export interface DiffPreviewMessage {
  type: 'diff-preview'
  saveId: string
  diff: SourceDiff
  warnings: string[]
  unsupported: string[]
}

/** A `save` produced no writable edit — e.g. an unsupported className shape or every change
 * unmappable. `reason` is shown to the user verbatim. */
export interface NoEditMessage {
  type: 'no-edit'
  saveId: string
  reason: string
}

/** The outcome of an `apply`. */
export interface ApplyResultMessage {
  type: 'apply-result'
  saveId: string
  success: boolean
  error?: string
}

/** The Tailwind theme source changed and the reverse-lookup was rebuilt; the runtime may want to
 * re-baseline or hint the user. */
export interface ConfigReloadedMessage {
  type: 'config-reloaded'
}

export type ServerMessage =
  | ServerInfoMessage
  | DiffPreviewMessage
  | NoEditMessage
  | ApplyResultMessage
  | ConfigReloadedMessage
