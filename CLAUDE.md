# CLAUDE.md — Shiage

Shiage (仕上げ, "finishing touches") lets a developer edit CSS live in Chrome DevTools and save
those tweaks back to source as Tailwind class edits — the "last 5%" of building a frontend with an
AI agent. Flow: `pnpm dev` → pick an element → edit CSS in real DevTools → an injected runtime
detects the computed-style changes → "Save N changes" → diff preview → confirm → the plugin
rewrites the JSX/TSX file → framework HMR repaints.

## Read first

- `SHIAGE_BUILD_PLAN.md` (repo root) — the strategic product/build plan (vision, phases,
  supported CSS properties in §7).
- The engineering implementation plan lives at
  `~/.claude/plans/users-horacechoi-desktop-shiage-build-p-dazzling-candy.md` — the concrete
  phase-by-phase execution plan. Its key decisions are summarized below.

## The one architecture decision that drives everything

**Do not reimplement Tailwind's value→class math. Drive Tailwind's own engine and invert it.**
Tailwind v4 exposes `__unstable__loadDesignSystem` (from `@tailwindcss/node`) returning a
`DesignSystem` with `candidatesToCss`, `getClassList`, `canonicalizeCandidates({ rem })`,
`resolveThemeValue`. We enumerate candidate classes → ask the engine what CSS each produces →
invert into `(property, value) → class` maps built against the user's *real* theme. v3 (no engine)
is shimmed from `jiti` + `tailwindcss/resolveConfig`. Both sit behind one version-agnostic
`ThemeSource` adapter; everything downstream is version-agnostic. (`__unstable__` API is pinned +
guarded by a CI smoke test.)

## Packages

- `@shiage/core` — framework-agnostic (Node, zero browser): ThemeSource + mapper, JSX AST editor,
  WS protocol + server plumbing, diff. `"sideEffects": false`.
- `@shiage/runtime` — browser (zero Node): Shadow-DOM overlay/picker/watcher/diff/WS client.
  Built as a single **IIFE** via tsup (`dist/shiage-runtime.iife.js`, exposed at `exports["./iife"]`).
- `@shiage/jsx-transform` — Babel plugin stamping `data-shiage-loc` on lowercase host elements.
- `@shiage/vite` — Vite plugin (`apply:'serve'`, `enforce:'pre'`).
- `@shiage/next` — Next.js plugin (webpack/Babel path; Turbopack is v1.1).

## Conventions

- TypeScript strict (`tsconfig.base.json`); `verbatimModuleSyntax` (use `import type`).
- Prettier: **no semicolons**, single quotes, 100 cols, trailing commas. Run `pnpm format`.
- pnpm workspaces; `pnpm -r build` builds in topological order (runtime before vite).
- Tests: Vitest. Node env by default; runtime tests use happy-dom via
  `// @vitest-environment happy-dom` docblock.
- **Demand tests** for every unit of logic (mapper, AST, transform, watcher).
- Tailwind: support **both v3 and v4** from day one via the `ThemeSource` abstraction.
- **Licensing is undecided** — no `LICENSE` file yet; leave package.json `license` fields unset; do
  not publish to npm until a license is chosen.

## Build order / current phase

Phases are tracked in the task list. Build phase-by-phase (0→5 to a working Vite milestone, then
6→7); write tests and make them pass before moving on. **Phases 0–5 complete** — the
version-agnostic CSS→Tailwind mapper (`@shiage/core`: v3/v4 `ThemeSource`, reverse-lookup,
`mapChangesToClassEdits`); the JSX/TSX AST editor (`packages/core/src/ast/`: `parse`, `find`,
`classname`, `merge`, `edit` — `editJsxFile`/`editJsxSource` locate an element by stamped loc and
rewrite its className via `magic-string`, never regenerating); the source-location stamper
(`@shiage/jsx-transform`: a Babel plugin stamping `data-shiage-loc="relPath:line:col"` on lowercase
host elements only, default-exported, runs before the JSX transform); and the browser runtime
(`@shiage/runtime`: closed-Shadow-DOM overlay/panel, capture-phase picker + highlight, dual-mechanism
watcher (MutationObserver for inline edits + 500ms `getComputedStyle` poll for stylesheet-rule edits,
with a sub-pixel + two-poll-stability guard), reconnecting WS client, and a `SourceDiff` renderer —
orchestrated by an idempotent `mount()` and built as a single IIFE). Pinned conventions:
`data-shiage-loc` line/column are **1-based** (Babel's `loc.start.column` is 0-based, so the stamper
adds one in Phase 3 and `find` subtracts one in Phase 2); the WS message contract lives in
`@shiage/core/src/protocol` (browser-safe — types + `PROTOCOL_VERSION`), and the runtime imports
only the Node-free subpaths `@shiage/core/supported` and `@shiage/core/protocol` (real package
exports, with vitest aliases + runtime tsconfig `paths` resolving them to source so tests/typecheck
are green from a clean clone without a build). Phase 5 added the WS protocol wiring + Vite plugin
(the v1 integration milestone): `buildSourceDiff` (`@shiage/core/diff`); the framework-agnostic Node
server plumbing (`@shiage/core/server`: `startWsServer` + `wireProtocol`, reused by both plugins);
`@shiage/vite` (`apply:'serve'`, `enforce:'pre'`) which detects Tailwind + builds the lookup in
`configureServer`, boots a free-port `ws` server, watches the theme source (→`config-reloaded`),
stamps JSX via the jsx-transform in `transform`, and inlines the runtime IIFE + `shiage-ws-port`
meta in `transformIndexHtml`; and `examples/vite-react` (a runnable Tailwind v4 demo). The full
pick→edit→save→diff→confirm→write→HMR flow is verified live in a browser. The watcher diffs
**longhands only** (box-model/gap/radius shorthands like `padding` are redundant reflections of
their longhands) and **suppresses layout-derived `width`/`height`/`min`/`max` changes when a
box-model property was edited** (unless the dimension is authored on the element's own inline
style), so editing padding on an auto-sized element yields a clean single-class edit instead of a
spurious `w-[Npx]`. Phase 6 added the Next.js plugin: `startShiageServer` was hoisted from
`@shiage/vite` into `@shiage/core/server/holder.ts` so both plugins reuse the same theme-detect +
ws-bind + reload loop. `@shiage/next` exposes `withShiage(nextConfig)` — a sync-when-possible
`webpack()` wrapper that fire-and-forgets a process-global WS-server boot (singleton-keyed by a
`Symbol.for('shiage.next.devServer')` on `globalThis`, so the three per-dev compile passes — client,
nodejs server, edge — share one server) and `unshift`s a `enforce:'pre'` loader rule running our
Babel stamp before SWC eats the JSX. The loader is CJS-emitted (`tsup format:['cjs']` with
`noExternal:['@shiage/jsx-transform']`) so webpack can `require()` it without ESM interop. The
rule's idempotency marker is a `Symbol` rather than a string, so webpack 5's strict rule-schema
validator (which only sees `Object.keys`) doesn't reject it. `<ShiageDevScripts />` is a sync server
component the user drops into the App Router root layout (or Pages `_document` body): it reads the
booted state and emits the `shiage-ws-port` meta + the inlined runtime IIFE (with
`<\/script>` escape) in dev, or `null` + a one-shot Turbopack-hint warn otherwise.
`examples/next-app/` is a Next 15 + Tailwind v4 demo. **Currently: Phase 7 (docs / demo / launch).**

## Resuming in a new session

Prefer a fresh session per phase — it avoids lossy context compaction and keeps cost/latency down.
To pick up cleanly:

1. **Orient.** This file and the user's memory auto-load. Read the engineering plan
   (`~/.claude/plans/users-horacechoi-desktop-shiage-build-p-dazzling-candy.md`) and run
   `git log --oneline` to see which phases are done. The current phase is marked just above.
2. **Confirm the foundation is green before building on it:** `pnpm install` (if needed), then
   `pnpm test && pnpm typecheck && pnpm lint`. The test suite is the contract — trust it.
3. **Source of truth** is git history + this file + the plan + the tests — *not* the in-session todo
   list (rebuild it each session). Update the "current phase" line above when a phase completes.
4. **Work happens on the `foundation` branch**; commit at each phase boundary with a descriptive
   message ending in the `Co-Authored-By` trailer. Push to back up / trigger CI.
