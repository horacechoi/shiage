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
6→7); write tests and make them pass before moving on. **Phases 0–3 complete** — the
version-agnostic CSS→Tailwind mapper (`@shiage/core`: v3/v4 `ThemeSource`, reverse-lookup,
`mapChangesToClassEdits`); the JSX/TSX AST editor (`packages/core/src/ast/`: `parse`, `find`,
`classname`, `merge`, `edit` — `editJsxFile`/`editJsxSource` locate an element by stamped loc and
rewrite its className via `magic-string`, never regenerating); and the source-location stamper
(`@shiage/jsx-transform`: a Babel plugin stamping `data-shiage-loc="relPath:line:col"` on lowercase
host elements only, default-exported, runs before the JSX transform). Pinned convention:
`data-shiage-loc` line/column are **1-based**; Babel's `loc.start.column` is 0-based, so the stamper
adds one (Phase 3) and `find` subtracts one (Phase 2). **Currently: Phase 4 (browser runtime in
`@shiage/runtime` — Shadow-DOM overlay/picker/watcher/diff/WS client, built as an IIFE).**

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
