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
6→7); write tests and make them pass before moving on. **Phases 0–1 complete** (monorepo + the
version-agnostic CSS→Tailwind mapper: `@shiage/core` with v3/v4 `ThemeSource`, reverse-lookup,
and `mapChangesToClassEdits`, all in `packages/core/src`). **Currently: Phase 2 (JSX/TSX AST editor).**
