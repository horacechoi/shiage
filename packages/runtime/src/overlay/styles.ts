// All overlay CSS, as one string injected into the Shadow DOM. The host div carries `all: initial`
// and the page's stylesheets (Tailwind preflight, resets) cannot cross the shadow boundary, so
// everything the overlay shows is styled here from scratch. Kept in a single <style> for one insert.

export const OVERLAY_CSS = `
:host { all: initial; }

.shiage-root {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483647;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: #e5e7eb;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

/* ── Pill ──
   42×42 icon button bearing the 24×24 table-edit mark (9px padding all sides). The count badge
   sits top-right and appears when the tracker has unsaved changes. No connection-status dot —
   the refined design drops it; setConnection is a no-op on the controller. */
.shiage-pill {
  position: relative;
  width: 42px;
  height: 42px;
  padding: 9px;
  border: none;
  border-radius: 9999px;
  background: #1a1a1a;
  color: #ffffff;
  font: inherit;
  cursor: pointer;
  box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.10), 0 2px 8px 0 rgba(0, 0, 0, 0.20);
  user-select: none;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.shiage-pill:hover { background: #2a2a2a; }
.shiage-pill__icon {
  display: inline-flex;
  width: 24px;
  height: 24px;
  color: #ffffff;
}
.shiage-pill__icon svg { width: 100%; height: 100%; display: block; }
/* Two icons coexist inside the pill (table-edit + close); the panel's [hidden] state — via
   :has() on the root — decides which one displays. Default: panel hidden → show edit, hide close. */
.shiage-pill__icon--open { display: none; }
.shiage-root:has(.shiage-panel:not([hidden])) .shiage-pill__icon--closed { display: none; }
.shiage-root:has(.shiage-panel:not([hidden])) .shiage-pill__icon--open {
  display: inline-flex;
  color: #cccccc;
}
.shiage-pill__badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 9999px;
  background: #ff0000;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.shiage-pill__badge[hidden] { display: none; }

/* ── Panel ──
   320px-wide column. Title + groups + button are spaced 16px apart by the body's gap; inside
   a title-section the title and its subtitle are spaced 8px so they stay paired visually. */
.shiage-panel {
  width: 320px;
  max-height: 70vh;
  overflow: auto;
  background: #1a1a1a;
  border-radius: 16px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.2);
  padding: 16px;
  box-sizing: border-box;
  transform-origin: bottom right;
}
.shiage-panel[hidden] { display: none; }
/* Short scale+fade entry. CSS animations re-fire when the rule becomes applicable again, so
   each open transition (i.e. removal of the [hidden] attribute) replays the keyframes. The
   transform-origin sits at the bottom-right corner so the panel grows out of the pill. */
.shiage-panel:not([hidden]) {
  animation: shiage-panel-appear 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes shiage-panel-appear {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .shiage-panel:not([hidden]) { animation: none; }
}

.shiage-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.shiage-title-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.shiage-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.shiage-title-icon {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  color: #ffffff;
}
.shiage-title-icon svg { width: 100%; height: 100%; display: block; }

.shiage-title {
  font-weight: 600;
  font-size: 16px;
  line-height: 1.5;
  color: #ffffff;
}
.shiage-muted {
  font-size: 14px;
  line-height: 1.5;
  color: #a4a4a4;
}
.shiage-loc {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 14px;
  color: #93c5fd;
  word-break: break-all;
}

/* ── Buttons ──
   Primary = white on black (Confirm, Save, Done). Secondary = transparent with a subtle border
   and gray text (Cancel, Back). The narrow modifier is for the terminal states (no-edit, error)
   where the design pins the button to 140px at the left edge. */
.shiage-btn {
  appearance: none;
  border: 1px solid #444444;
  border-radius: 8px;
  background: transparent;
  color: #a1a1a1;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  font-weight: 500;
  padding: 8px 12px;
  cursor: pointer;
  text-align: center;
  box-sizing: border-box;
}
.shiage-btn:hover:not(:disabled) { background: #2a2a2a; color: #f9fafb; }
.shiage-btn:disabled { opacity: 0.5; cursor: default; }
.shiage-btn--primary {
  background: #ffffff;
  border-color: #ffffff;
  color: #000000;
}
.shiage-btn--primary:hover:not(:disabled) {
  background: #e5e7eb;
  border-color: #e5e7eb;
  color: #000000;
}
.shiage-btn--narrow { width: 140px; align-self: flex-start; }

/* Top-level standalone (non-row) buttons span the panel width except when narrow. */
.shiage-body > .shiage-btn:not(.shiage-btn--narrow) { width: 100%; }

.shiage-btn-row { display: flex; gap: 8px; width: 100%; }
.shiage-btn-row .shiage-btn { flex: 1; }

.shiage-warn-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}
.shiage-warn {
  color: #fbbf24;
  font-size: 12px;
  line-height: 16px;
}
.shiage-error { color: #f87171; }

/* ── Group cards (tracking view) ──
   One per element. Head row: checkbox + tag + loc on the left, trash-icon Remove on the right.
   Property rows are indented under the head and use a monospace font. */
.shiage-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.shiage-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  background: #101010;
  box-sizing: border-box;
}
.shiage-group--excluded { opacity: 0.4; }
.shiage-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.shiage-group__head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}
.shiage-group__head .shiage-title {
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
  color: #f9fafb;
}

.shiage-group__remove {
  appearance: none;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 4px;
  border: 1px solid #444444;
  border-radius: 6px;
  background: transparent;
  color: #a1a1a1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.shiage-group__remove:hover { background: #2a2a2a; color: #f9fafb; }
.shiage-group__remove .shiage-icon {
  display: inline-flex;
  width: 14px;
  height: 14px;
}
.shiage-group__remove .shiage-icon svg { width: 100%; height: 100%; display: block; }

.shiage-prop {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 16px;
  color: #d1d5db;
  padding-left: 20px;
}
.shiage-prop--excluded { opacity: 0.4; }

.shiage-check {
  accent-color: #2563eb;
  width: 14px;
  height: 14px;
  flex: none;
  cursor: pointer;
  margin: 0;
}
.shiage-group__head .shiage-check { width: 16px; height: 16px; }

/* ── Picker highlight ──
   The element-picker draws a translucent rectangle over the hovered/picked element. Unchanged
   from the previous design. */
.shiage-highlight {
  position: fixed;
  pointer-events: none;
  z-index: 2147483646;
  box-sizing: border-box;
  border: 2px solid #2563eb;
  background: rgba(37, 99, 235, 0.12);
  border-radius: 2px;
}

/* ── Diff blocks (preview view) ──
   One block per SourceDiff: a file header (monospace, black background) followed by add/del
   lines with colored gutters. The container's overflow-clip and rounded corners hide the lines
   that bleed up against the edges. */
.shiage-diffs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.shiage-diff {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  background: #101010;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  overflow: hidden;
}
.shiage-diff__file {
  padding: 6px 10px;
  background: #000000;
  color: #a1a1a1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 16px;
  word-break: break-all;
}
.shiage-diff__line {
  display: flex;
  white-space: pre-wrap;
  padding: 1px 0;
  line-height: 16px;
}
.shiage-diff__gutter {
  width: 18px;
  flex: none;
  text-align: center;
  color: #6b7280;
  user-select: none;
}
.shiage-diff__text { flex: 1; color: #d1d5db; word-break: break-all; }
.shiage-diff__line--add { background: rgba(34, 197, 94, 0.14); }
.shiage-diff__line--add .shiage-diff__gutter { color: #4ade80; }
.shiage-diff__line--del { background: rgba(239, 68, 68, 0.14); }
.shiage-diff__line--del .shiage-diff__gutter { color: #f87171; }
`
