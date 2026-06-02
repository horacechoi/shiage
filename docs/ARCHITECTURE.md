# Architecture

How the pieces of Shiage fit together. If you're contributing, start here.

Shiage lets a developer edit CSS live in Chrome DevTools and save those tweaks back to
source as Tailwind class edits — the "last 5%" of building a frontend with an AI agent.
The flow:

```
pnpm dev → pick an element → edit CSS in real DevTools → "Save N changes" → diff preview
        → confirm → the plugin rewrites the JSX/TSX file → framework HMR repaints
```

---

## The one decision that drives everything

**Don't reimplement Tailwind's value→class math. Drive Tailwind's own engine and invert it.**

Tailwind v4 exposes `__unstable__loadDesignSystem` from `@tailwindcss/node`, which returns
a `DesignSystem` with:

```ts
candidatesToCss(classes): (string|null)[]   // 'p-4' → '.p-4 { padding: calc(var(--spacing) * 4) }'
getClassList(): ClassEntry[]                // enumerate every utility the theme can produce
canonicalizeCandidates(classes, { rem }): string[]  // 'p-[16px]' → 'p-4', with px↔rem built in
resolveThemeValue(path): string | undefined // '--spacing' → '0.25rem'
```

We enumerate candidate classes → ask the engine what CSS each produces → invert into
`(property, value) → class` maps built against the user's *real* resolved theme. Tailwind
v3 (which has no engine) is shimmed from `jiti` + `tailwindcss/resolveConfig`. Both sit
behind one version-agnostic `ThemeSource` adapter; everything downstream is version-
agnostic and the same test suite covers both. The `__unstable__` API is pinned to a
tested minor range with a CI smoke test, so a breaking Tailwind bump fails loudly.

```ts
interface CssDecl { property: string; value: string }      // longhand, normalized
interface ThemeSource {
  readonly version: 3 | 4
  readonly sourcePath: string
  classToDecls(classNames: string[]): CssDecl[][]
  enumerateCandidates(ns: TailwindNamespace[]): string[]
  canonicalize(classNames: string[], rootFontSizePx: number): string[]
  resolveToken(path: string): string | undefined
}
```

---

## Packages

| Package | Role | Runtime |
|---|---|---|
| `@shiage/core` | CSS→Tailwind mapper, JSX AST editor, WebSocket protocol, diff, server plumbing | Node, `"sideEffects": false` |
| `@shiage/runtime` | Shadow-DOM overlay, picker, watcher, diff renderer, WS client | Browser-only IIFE |
| `@shiage/jsx-transform` | Babel plugin that stamps `data-shiage-loc` on lowercase host elements | Babel plugin |
| `@shiage/vite` | Vite plugin (`apply: 'serve'`, `enforce: 'pre'`) | Node |
| `@shiage/next` | Next.js plugin (webpack/Babel path; Turbopack is v1.1) | Node |

The runtime is built as a single IIFE (`tsup --format iife`, exposed at `exports["./iife"]`)
that the Vite and Next plugins inline into your dev HTML. The Node and browser code
never coexist in one bundle — they literally can't.

`@shiage/core` is `"sideEffects": false` so the runtime can tree-shake the
browser-safe subpaths (`@shiage/core/supported`, `@shiage/core/protocol`) into its
IIFE without pulling Node code.

---

## How the pick→edit→save→write flow works

**Source-location stamping** (`@shiage/jsx-transform`): a Babel plugin visits every
`JSXOpeningElement` and stamps `data-shiage-loc="${relPath}:${line}:${col}"` on
**lowercase host elements only** (skips uppercase React components, `JSXFragment`,
`JSXMemberExpression`). It runs **before** React's JSX transform so the attribute
survives into the DOM. Production builds disable it entirely.

> **Pinned convention:** `data-shiage-loc` line/column are **1-based**. Babel's
> `loc.start.column` is 0-based, so the stamper adds 1; `find` in the AST editor
> subtracts 1. This split is asserted in tests.

**Browser runtime** (`@shiage/runtime`): an idempotent `mount()` (guarded on
`window.__SHIAGE__` for HMR re-injection) creates a `data-shiage-host` div with
`all: initial; z-index: 2147483647` and a **closed** Shadow DOM, so Tailwind preflight
can't reach in. One `<style>` element holds all overlay CSS.

**Picker:** capture-phase `mousemove` / `click` / `keydown`. A separate
`position: fixed; pointer-events: none` highlight layer tracks the hovered element via
`getBoundingClientRect`. Click resolves the nearest `data-shiage-loc` ancestor; Esc
cancels.

**Watcher — dual mechanism** (the load-bearing detection insight):

- A **`MutationObserver`** on `style`/`class` attributes catches **inline DevTools edits
  instantly** — these mutate the element's own `style` attribute.
- A **500ms `getComputedStyle` poll** catches **stylesheet-rule edits**, which don't
  mutate the element at all (they change the CSSOM rule, reflected only via
  `getComputedStyle`). This was experimentally verified — no other mechanism catches
  them without a Chrome extension.

False-positive guards:
- Sub-pixel rounding (0.5px threshold).
- Two-poll stability before counting (transitions-in-flight guard; MutationObserver path
  bypasses this since inline edits are atomic).
- Normalized-string comparison for color values.
- Unsupported properties are tracked separately so the diff panel can show them
  explicitly rather than silently dropping.

The watcher **diffs longhands only** — box-model / gap / radius shorthands like
`padding` are redundant reflections of their longhands. It **suppresses layout-derived
`width`/`height`/`min`/`max` changes when a box-model property was edited** (unless the
dimension is authored on the element's own inline style), so editing padding on an
auto-sized element yields a clean single-class edit instead of a spurious `w-[Npx]`.

**Mapper → class edits** (`@shiage/core`): the **directional-shorthand heuristic** is
the correctness invariant. Changes are grouped by physical group (padding / margin /
border-width / border-radius):

- All four sides same → shorthand (`p-6`)
- Both sides of an axis → axis class (`px-6`)
- Single side → directional (`pl-6`)
- If a broader existing token like `p-4` covers a side being changed, **decompose** it
  into the 3 unchanged sides plus the new one (`pt-4 pr-4 pb-4 pl-6`), then re-collapse
  any opposite pairs that now match.

**The mapper never silently changes a side the user didn't touch.** `classProducingProperty`
asks `source.classToDecls` which longhands each existing token sets — authoritative, not
guessed.

Misses fall back to arbitrary classes (`pl-[23px]`, `text-[#0c2238]`). On v4, misses are
run through `canonicalize` first to recover exact matches under custom `--spacing`
scales. Color matching normalizes to `rgb(r,g,b)`, prefers exact match, then nearest
within a tight threshold (rgb distance ≲5) with a visible warning, then arbitrary hex.

**AST editor** (`@shiage/core/src/ast/`): `editJsxFile(filePath, line, col, edits)`
parses with `@babel/parser`, locates the node by stamped loc, and edits original text
with `magic-string` — **never regenerates via `@babel/generator`** (it mangles
formatting). className-shape handling:

| Shape | Behavior |
|---|---|
| String literal / template w/o expr / `cn()`/`clsx()` with string-literal args | **Editable** |
| Template w/ expr | Edit static quasis only — **partial** |
| `cn()` with conditionals | Edit static args only — **partial** |
| Variable reference / `style={}` / CSS-Modules `styles.foo` | **`unsupported`** with a specific reason forwarded to the diff panel |
| No className + pure additions | Insert a new `className="…"` attribute |

`mergeClassString` tokenizes → drops exact removals **and** conflicting tokens (adding
`pl-6` removes leftover `pl-4`; `text-red-500` removes `text-blue-500`, via
`classProducingProperty` in reverse) → appends deduped additions → **preserves
unrelated and variant-prefixed tokens (`md:p-4`, `hover:…`) untouched** → joins with
single spaces, doesn't reorder.

**Server plumbing** (`@shiage/core/src/server/`): `startWsServer` / `wireProtocol` /
`startShiageServer` are Node-only modules reused by both the Vite and Next plugins.
Avoids a 6th package; zero browser code reaches `@shiage/runtime` from here.

**Vite plugin** (`@shiage/vite`): `apply: 'serve'` (true no-op in build),
`enforce: 'pre'` (stamp before React transform). `configResolved` → detect theme + build
lookup. `configureServer` → start standalone `ws` server on a free port, wire protocol,
watch the theme source file → broadcast `config-reloaded`. `transform` → run jsx-transform on `.tsx`/`.jsx` (skip `node_modules`). `transformIndexHtml` → inject
`<meta name="shiage-ws-port">` + inline runtime IIFE.

**Next plugin** (`@shiage/next`): `withShiage(nextConfig)` is a sync-when-possible
`webpack()` wrapper that fire-and-forgets a process-global WS-server boot. The boot is
singleton-keyed by `Symbol.for('shiage.next.devServer')` on `globalThis` so the three
per-dev compile passes (client, nodejs server, edge) share one server. The loader rule
is `unshift`ed at `enforce: 'pre'` so the Babel stamp runs before SWC eats the JSX. The
loader itself is CJS-emitted (`tsup format: ['cjs']` with
`noExternal: ['@shiage/jsx-transform']`) so webpack can `require()` it without ESM
interop. The rule's idempotency marker is a `Symbol` rather than a string, because
webpack 5's strict rule-schema validator only sees `Object.keys` and would reject an
unknown string field.

`<ShiageDevScripts />` is a sync server component the user drops into the App Router
root layout (or Pages `_document` body): it reads the booted state and emits the
`shiage-ws-port` meta + the inlined runtime IIFE (with `<\/script>` escape) in dev,
or `null` + a one-shot Turbopack-hint warn otherwise.

---

## Conventions

- TypeScript strict (`tsconfig.base.json`); `verbatimModuleSyntax` (use `import type`).
- Prettier: **no semicolons**, single quotes, 100 columns, trailing commas. Run `pnpm format`.
- pnpm workspaces; `pnpm -r build` builds in topological order (runtime before vite).
- Tests: **Vitest**. Node env by default; runtime tests use happy-dom via
  `// @vitest-environment happy-dom` docblock. Watcher integration uses fake timers.
- **Tests demanded** for every unit of logic (mapper, AST, transform, watcher).
- Tailwind: **both v3 and v4** are supported from one codebase via the `ThemeSource`
  abstraction. Mapper tests run against fixtures of both.
- `data-shiage-loc` line/column are **1-based** (Babel's are 0-based; the stamper
  adjusts; the AST `find` step un-adjusts). Asserted in tests.
- WS message contract lives in `@shiage/core/src/protocol` — browser-safe (types +
  `PROTOCOL_VERSION`). The runtime imports only `@shiage/core/supported` and
  `@shiage/core/protocol` (real package exports, with vitest aliases + runtime tsconfig
  `paths` resolving them to source so tests/typecheck are green from a clean clone
  without a build).

---

## Verification layers

Real Chrome DevTools editing can't be driven by a test runner, so verification is
layered:

1. **Unit (Vitest, in `core`)** — covers ~80% of risk. Mapper × every v1 property ×
   {exact, arbitrary, decomposition, color exact/near, unsupported} run against **both**
   a v3 and a v4 fixture; AST editor (every className shape, exact-output assertions);
   jsx-transform (`@babel/core.transformSync`); resolve-value arithmetic.
2. **Watcher integration (happy-dom, headless)** — simulates both DevTools mechanisms:
   `el.style.x=…` → MutationObserver fires; mutating `document.styleSheets[0].cssRules[0].style.x`
   + advancing 500ms fake timer → poll catches, MutationObserver doesn't.
3. **Protocol/server integration (headless, no browser)** — spins up the `ws` server,
   connects a client, `save` against a temp fixture file, asserts `diff-preview`,
   `apply`, asserts file changed. Full map→edit→diff→write without a browser.
4. **Manual** — see [`docs/MANUAL_TEST.md`](MANUAL_TEST.md) for the release-time human
   checklist covering the DevTools chrome paths that automation can't reach.

---

## What's not in v1

Documented one-line rationales in the [main README](../README.md#whats-not-yet) — short
version: Turbopack (v1.1), CSS Modules / inline `style={}` / vanilla CSS / CSS-in-JS,
non-JSX frameworks. The seams are clean for adding any of these later; they're not in
v1 because each is its own contract and getting one right is better than getting four
half-right.
