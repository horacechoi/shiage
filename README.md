# Shiage 仕上げ

[![npm](https://img.shields.io/npm/v/@shiage/vite.svg?label=%40shiage%2Fvite)](https://www.npmjs.com/package/@shiage/vite)
[![npm](https://img.shields.io/npm/v/@shiage/next.svg?label=%40shiage%2Fnext)](https://www.npmjs.com/package/@shiage/next)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/horacechoi/shiage/actions/workflows/ci.yml/badge.svg)](https://github.com/horacechoi/shiage/actions/workflows/ci.yml)

**Shiage** (仕上げ, *shee-AH-geh*) is Japanese for "finishing touches" — the last 5%
of work that separates "almost done" from "actually done."

Building a frontend with an AI agent gets you 95% there. The structure arrives,
components render, data flows. What's left is the painful part: spacing is slightly
off, padding's wrong, the border-radius needs a nudge, that color isn't quite the
shade you wanted. Shiage is for that last 5%.

It's a Vite and Next.js plugin (with an injected browser runtime). You open your
site, pick an element, edit CSS values directly in Chrome DevTools, and click Save —
Shiage rewrites the JSX file as Tailwind class edits, HMR repaints. Your DevTools
nudges become real source-code changes.

```
pick element  →  edit CSS in real DevTools  →  Save 3 changes  →  diff preview  →  confirm  →  file rewritten  →  HMR
```

> _A 30s demo video is coming with the public launch._

---

## Quick start — Vite

```bash
pnpm i -D @shiage/vite
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import shiage from '@shiage/vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), shiage()],
})
```

`pnpm dev`, open the URL, click the Shiage pill (bottom-right), pick an element, edit
its CSS in DevTools. The plugin is `apply: 'serve'` — a true no-op in production
builds.

## Quick start — Next.js

```bash
pnpm i -D @shiage/next
```

```js
// next.config.mjs
import withShiage from '@shiage/next'

/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true }

export default withShiage(nextConfig)
```

```tsx
// app/layout.tsx
import { ShiageDevScripts } from '@shiage/next'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ShiageDevScripts />
      </body>
    </html>
  )
}
```

> **Next 16+ needs `--webpack`.** Turbopack ignores `webpack()` config, so v1
> requires the webpack dev server: `next dev --webpack`. Next 15 still defaults to
> webpack — plain `next dev` is enough. Turbopack support is planned for v1.1.

`ShiageDevScripts` is a server component that emits the runtime + WS port in dev and
renders `null` in production. Drop it in the App Router's root layout, or in `_document`'s
body for the Pages Router.

---

## What's supported

40 CSS properties across 6 groups — the ones you actually nudge in DevTools day to day.
See [`SUPPORTED_PROPERTIES.md`](SUPPORTED_PROPERTIES.md) for the full table.

| Group | Properties |
| --- | --- |
| **Spacing** | `padding{,-top,-right,-bottom,-left}`, `margin{,-top,-right,-bottom,-left}`, `gap`, `row-gap`, `column-gap` |
| **Sizing** | `width`, `height`, `min-width`, `min-height`, `max-width`, `max-height` |
| **Typography** | `color`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `text-align` |
| **Background** | `background-color` |
| **Border** | `border-{top,right,bottom,left}-width`, `border-width`, `border-color`, `border-style`, `border-radius`, `border-{top,bottom}-{left,right}-radius` |
| **Effects** | `opacity`, `box-shadow` |

Shiage maps against your *real* resolved Tailwind theme (custom `--spacing`, custom
colors, custom shadows), not a hardcoded scale — built by driving Tailwind's own
engine and inverting it, so v3 and v4 work identically. Misses fall back to arbitrary
values (`pl-[23px]`, `text-[#0c2238]`), with v4 canonicalization run first to recover
exact matches under custom token scales.

## What's not (yet)

| | Reason |
| --- | --- |
| **Turbopack** | Webpack-only for v1 — Turbopack ignores the `webpack()` callback. v1.1. |
| **CSS Modules (`styles.foo`)** | Marked unsupported in the diff panel; we'd be rewriting a different file with different conventions. v1.5 candidate. |
| **Inline `style={}`** | Same reason — different write target. |
| **Vanilla CSS / CSS-in-JS** | Shiage's contract is "Tailwind class edits." Other targets are different products. |
| **Vue / Svelte / Solid / Astro** | JSX/TSX only. Other JSX-aware frameworks would slot in cleanly later; non-JSX frameworks would need a separate transform. |

---

## FAQ

**Does this work without Tailwind?** No — by design. Shiage's whole value is round-tripping
through your real Tailwind theme. For vanilla CSS, the right tool would be different.

**Does this work with CSS Modules / `style={}` / `styled-components`?** No in v1. When
Shiage finds a className it can't safely edit (variable references, `styles.foo`, `style={…}`),
the diff panel shows an explicit "unsupported, reason: …" message rather than guessing.

**Does this need a browser extension?** No. The plugin injects a closed-Shadow-DOM
runtime IIFE into your dev page. Nothing to install in Chrome.

**Does this work with Turbopack?** Not in v1. Turbopack ignores Next's `webpack()`
callback, so the JSX source-location stamper never runs. Use `next dev --webpack` on
Next 16+, or plain `next dev` on Next 15. v1.1 will add a Turbopack path.

**How does this know my element's source location?** A Babel plugin stamps every
lowercase host element with `data-shiage-loc="src/Card.tsx:42:9"` during dev. Production
builds strip it.

**How does it detect DevTools edits without an extension?** Two mechanisms, side by side:
a `MutationObserver` on `style` and `class` (instant; catches inline DevTools edits) plus
a 500ms `getComputedStyle` poll (catches stylesheet-rule edits, which don't mutate the
element). Both are guarded against sub-pixel noise and transitions-in-flight.

**Any telemetry?** None. The runtime only talks to the local WebSocket server the dev
plugin booted on your machine.

**Why MIT?** Shiage is a dev-time plugin — nothing to host, nothing to fork-and-resell-as-a-service.
The adoption cost of a non-OSI license (enterprise allowlists, contributor hesitation)
wouldn't buy any real protection. Every comparable tool — Vite plugins, Tailwind plugins,
Babel plugins — is MIT.

---

## Examples

Two runnable demo apps in this repo, both styled with Tailwind v4 and a custom theme
token so you can verify Shiage maps against your real theme:

- [`examples/vite-react`](examples/vite-react) — Vite + React + `@shiage/vite`
- [`examples/next-app`](examples/next-app) — Next.js (App Router) + `@shiage/next`

```bash
pnpm install
pnpm -r build
pnpm --filter @shiage-example/vite-react dev   # or @shiage-example/next-app
```

---

## Packages

| Package | Role |
| --- | --- |
| [`@shiage/vite`](packages/vite) | Vite plugin — start here for Vite projects |
| [`@shiage/next`](packages/next) | Next.js plugin (webpack/Babel; Turbopack v1.1) |
| [`@shiage/core`](packages/core) | Framework-agnostic mapper, AST editor, WS protocol, diff |
| [`@shiage/runtime`](packages/runtime) | Browser runtime IIFE — picker, watcher, diff panel |
| [`@shiage/jsx-transform`](packages/jsx-transform) | Babel plugin that stamps `data-shiage-loc` |

---

## Status

v0.1 — working but young. Bug reports welcome; expect occasional breaking changes
under `0.x`. Public API will stabilize on `1.0`. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup,
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit together, and
[`docs/MANUAL_TEST.md`](docs/MANUAL_TEST.md) for the release-time human checklist.

## License

[MIT](LICENSE) — © 2026 Horace Choi.
