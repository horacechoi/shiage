# @shiage/runtime

Browser runtime for [Shiage](https://shiage.dev) — the closed-Shadow-DOM overlay,
element picker, dual-mechanism style watcher, diff panel, and WebSocket client. Built as
a single inlinable IIFE (`dist/shiage-runtime.iife.js`, exposed at `exports["./iife"]`).

> **You almost never install this directly.** The
> [`@shiage/vite`](https://www.npmjs.com/package/@shiage/vite) and
> [`@shiage/next`](https://www.npmjs.com/package/@shiage/next) plugins inline this IIFE
> into your dev HTML at serve time. If you're a framework-plugin author building a new
> Shiage adapter, you'll read the IIFE off disk via `require.resolve('@shiage/runtime/iife')`
> and inject it the same way.

## What it does

- Idempotent `mount()` (guarded on `window.__SHIAGE__` so HMR re-injection is safe).
- A `data-shiage-host` div with `all: initial; z-index: 2147483647` and a closed Shadow
  DOM, so Tailwind preflight can't reach in.
- Capture-phase picker with a separate fixed-position highlight layer.
- **Dual watcher:** `MutationObserver` on `style`/`class` catches inline DevTools edits
  instantly; a 500ms `getComputedStyle` poll catches stylesheet-rule edits that don't
  mutate the element. Sub-pixel + two-poll-stability guards keep transitions from
  triggering false positives.
- Reconnecting WebSocket client; save IDs correlate diff previews to confirms.
- `sessionStorage` persistence of the picked `data-shiage-loc` so the target survives a
  full reload (HMR survival).

## License

[MIT](https://github.com/horacechoi/shiage/blob/main/LICENSE) — © 2026 Horace Choi.
