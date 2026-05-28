// The WebSocket message contract between the browser runtime (@shiage/runtime) and the dev-server
// plugin (@shiage/vite, @shiage/next). This module is the single source of truth for the wire
// shapes and is deliberately dependency-free and browser-safe: the runtime imports these as types
// (erased at build) plus the PROTOCOL_VERSION constant, so nothing Node-only is pulled into the
// IIFE. The plugin (Phase 5) maps `save.changes` through mapChangesToClassEdits and builds the
// SourceDiff it sends back.

/** Bumped when a wire shape changes incompatibly. Exchanged in `hello`/`server-info` so each side
 * can warn on a mismatch instead of failing cryptically.
 *
 * `2`: ambient multi-element batch save. `SaveMessage.edits[]` carries one entry per tracked
 * element (possibly across multiple files), and `DiffPreviewMessage.diffs[]` returns one entry per
 * touched file. v1 was the single-`sourceLoc` / single-`diff` shape. */
export const PROTOCOL_VERSION = 2

/**
 * One computed-style property the runtime observed change on a tracked element. `oldValue` is the
 * value snapshotted at baseline, `newValue` the current computed value (both raw `getComputedStyle`
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

/** One tracked element's contribution to a batch save: where its className lives in source, its
 * current className text (the editor merges into this), and the property changes it has accrued. */
export interface ElementEdit {
  /** The element's stamped `data-shiage-loc`, e.g. `"src/App.tsx:42:9"`. */
  sourceLoc: string
  /** The element's current className string (what the editor merges into). */
  className: string
  changes: PropertyChange[]
}

/** Request to turn the runtime's accumulated style changes — possibly across multiple elements and
 * files — into proposed source edits. The server stages (does not write) the edits and replies
 * with `diff-preview` or `no-edit`. */
export interface SaveMessage {
  type: 'save'
  /** Correlates the eventual `diff-preview`/`no-edit`/`apply-result` back to this request. */
  saveId: string
  /** One entry per tracked element with at least one change; may span multiple source files. */
  edits: ElementEdit[]
  /** The live `document.documentElement` font-size in px, so the server normalizes rem against the
   * real root size rather than assuming 16. One value for the whole batch. */
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

/** The staged edits for a `save`, awaiting the user's confirm. One `SourceDiff` per touched file:
 * multiple elements in the same file collapse into one diff with multiple hunks; elements in
 * different files yield separate entries. `warnings` surfaces non-blocking notes (e.g. color
 * snapping, per-element failures the batch skipped over); `unsupported` lists properties that
 * couldn't be mapped anywhere in the batch. */
export interface DiffPreviewMessage {
  type: 'diff-preview'
  saveId: string
  diffs: SourceDiff[]
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
