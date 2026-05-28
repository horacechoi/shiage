// All overlay CSS, as one string injected into the Shadow DOM. The host div carries `all: initial`
// and the page's stylesheets (Tailwind preflight, resets) cannot cross the shadow boundary, so
// everything the overlay shows is styled here from scratch. Kept in a single <style> for one insert.

export const OVERLAY_CSS = `
:host { all: initial; }

.shiage-root {
  position: fixed;
  bottom: 16px;
  right: 16px;
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

.shiage-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: none;
  border-radius: 9999px;
  background: #111827;
  color: #f9fafb;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  user-select: none;
}
.shiage-pill:hover { background: #1f2937; }
.shiage-pill__dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: #6b7280;
}
.shiage-pill__dot--open { background: #34d399; }
.shiage-pill__dot--connecting { background: #fbbf24; }
.shiage-pill__dot--closed { background: #f87171; }

.shiage-panel {
  width: 320px;
  max-height: 70vh;
  overflow: auto;
  background: #0b1220;
  border: 1px solid #1f2937;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.shiage-panel[hidden] { display: none; }

.shiage-title { font-weight: 700; color: #f9fafb; }
.shiage-muted { color: #9ca3af; }
.shiage-loc {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #93c5fd;
  word-break: break-all;
}

.shiage-btn {
  appearance: none;
  border: 1px solid #374151;
  border-radius: 8px;
  background: #1f2937;
  color: #f9fafb;
  font: inherit;
  font-weight: 600;
  padding: 8px 12px;
  cursor: pointer;
  text-align: center;
}
.shiage-btn:hover:not(:disabled) { background: #374151; }
.shiage-btn:disabled { opacity: 0.5; cursor: default; }
.shiage-btn--primary { background: #2563eb; border-color: #2563eb; }
.shiage-btn--primary:hover:not(:disabled) { background: #1d4ed8; }
.shiage-btn-row { display: flex; gap: 8px; }
.shiage-btn-row .shiage-btn { flex: 1; }

.shiage-warn { color: #fbbf24; font-size: 12px; }
.shiage-error { color: #f87171; }

.shiage-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid #1f2937;
  border-radius: 8px;
  background: #0b1220;
}
.shiage-group--excluded { opacity: 0.55; }
.shiage-group__head { display: flex; align-items: center; gap: 8px; }
.shiage-group__head .shiage-title { font-weight: 600; }
.shiage-group__head .shiage-loc { font-size: 11px; }

.shiage-prop {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #d1d5db;
  padding-left: 20px;
}
.shiage-prop--excluded { opacity: 0.5; text-decoration: line-through; }

.shiage-check {
  accent-color: #2563eb;
  width: 14px;
  height: 14px;
  flex: none;
  cursor: pointer;
  margin: 0;
}

.shiage-highlight {
  position: fixed;
  pointer-events: none;
  z-index: 2147483646;
  box-sizing: border-box;
  border: 2px solid #2563eb;
  background: rgba(37, 99, 235, 0.12);
  border-radius: 2px;
}

.shiage-diff {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  background: #020617;
  border: 1px solid #1f2937;
  border-radius: 8px;
  overflow: hidden;
}
.shiage-diff__file {
  padding: 6px 10px;
  background: #111827;
  color: #93c5fd;
  border-bottom: 1px solid #1f2937;
  word-break: break-all;
}
.shiage-diff__line { display: flex; white-space: pre-wrap; }
.shiage-diff__gutter {
  width: 1.5em;
  flex: none;
  text-align: center;
  color: #6b7280;
  user-select: none;
}
.shiage-diff__text { flex: 1; word-break: break-all; }
.shiage-diff__line--add { background: rgba(34, 197, 94, 0.14); }
.shiage-diff__line--add .shiage-diff__gutter { color: #4ade80; }
.shiage-diff__line--del { background: rgba(239, 68, 68, 0.14); }
.shiage-diff__line--del .shiage-diff__gutter { color: #f87171; }
`
