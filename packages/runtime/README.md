# @shiage/runtime

Browser runtime for [Shiage](https://shiage.dev) — the closed-Shadow-DOM overlay,
ambient multi-element watcher, diff panel, and WebSocket client. Built as
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
- **Ambient watch-manager:** auto-tracks *every* stamped element — no "pick" step. Edit
  anything in Chrome DevTools and it's detected; edits across multiple elements batch into
  one save, grouped by element in the panel.
- **Dual detection:** one document-wide `MutationObserver` on the `style` attribute
  catches inline DevTools edits instantly; one shared 500ms `getComputedStyle` poll
  catches stylesheet-rule edits that don't mutate the element. Sub-pixel +
  two-poll-stability guards keep transitions from triggering false positives.
- Reconnecting WebSocket client; save IDs correlate diff previews to confirms.
- Survives HMR and full reloads by re-discovering stamped elements automatically — no
  `sessionStorage`, no re-pick.

## License

[MIT](https://github.com/horacechoi/shiage/blob/main/LICENSE) — © 2026 Horace Choi.
