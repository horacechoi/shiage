# Shiage — Build Plan (v1)

> **Tagline:** Inspect and edit CSS on Chrome.

---

## 1. About the name

**Shiage** (仕上げ) is a Japanese word meaning "finishing touches" or "the completion stage." It is the discipline of bringing nearly-done work to its actual conclusion through careful, deliberate small adjustments. The word appears across Japanese craft traditions:

- In **manufacturing and craftsmanship**, *shiage* is the final stage where a piece is polished, refined, and brought to its finished form.
- In **art**, it is the final brushstrokes that make a painting whole.
- In **sushi**, *shiage* (sometimes called *nitsume*) is the glaze of sweet sauce brushed on at the end — the last touch that elevates the dish.
- In **business**, *shiage* refers to the final 5% of any project: the small adjustments that separate "almost done" from "actually done."

This is exactly what the product is for. When you build a frontend with an AI coding agent, the structure and components arrive quickly. The layout is right. The data flows. But the spacing is slightly off, the padding is wrong, the border-radius needs a nudge, the color isn't quite the shade you wanted. That last 5% — currently the most painful part of working with an agent — is where Shiage lives.

### How to talk about the name

**Pronunciation:** *shee-AH-geh* (three syllables, slight emphasis on the middle).

**In the README and copy:** lead with the meaning. "Shiage (仕上げ) is Japanese for 'finishing touches.' This is the tool for the final 5% of your frontend."

**On the website:** include the kanji 仕上げ. It's visually distinctive and reinforces the craft positioning.

**Talking points for launch posts / interviews:**
- "Building a frontend with an AI agent gets you 95% there. Shiage handles the 5%."
- "Designers and frontend devs already use Chrome DevTools to nudge CSS values. Shiage saves those nudges to your source."
- "Shiage is the Japanese word for finishing touches. The discipline of getting things actually done."

---

## 2. Product summary

### What it does

Shiage is a Vite and Next.js plugin (with an injected browser runtime) that lets a developer edit CSS directly in Chrome DevTools and save those changes back to their source code as Tailwind classes. The workflow:

1. The developer runs `npm run dev` as normal.
2. They open their site, click Shiage's "pick element" button, and click any element on the page.
3. They open Chrome DevTools normally and edit CSS values — padding, color, border, whatever.
4. Shiage's overlay shows a live count: "Save 3 changes."
5. They click save. A diff review panel shows the proposed source-code change.
6. They confirm. The file is rewritten. Vite/Next HMR repaints the browser.

### Who it's for

- Developers who build frontends with AI coding agents (Claude Code, Cursor, Codex) and find the final visual polish painful.
- Designers who can read code but find it tedious to translate Chrome DevTools tweaks into agent prompts.
- Frontend engineers who want to skip the "describe the change in words" middleman when working with an agent.

### Positioning vs. existing tools

- **Agentation** — annotation tool. You point at elements and write notes; an agent acts on them. Shiage skips the note step entirely: the DevTools edit *is* the input.
- **Inspector, Onlook** — full visual IDEs that wrap an agent. Shiage is much narrower and lighter: it doesn't replace DevTools, it bridges DevTools to source.
- **Builder.io Visual Copilot, Locofy** — design-to-code tools. Different category.

The wedge: people already use Chrome DevTools every day. Don't replace it, make it write to source.

---

## 3. Locked-in decisions

These are settled and the rest of the plan assumes them.

- **Framework targets for v1**: React on Vite and React on Next.js.
- **Styling target for v1**: Tailwind CSS. CSS Modules is a v1.5 add. CSS-in-JS is not in v1.
- **DevTools integration**: native Chrome DevTools. No Chrome extension in v1 (would be a v2 quality-of-life add).
- **Detection mechanism**: pick step required. After pick, a MutationObserver plus a 500ms computed-style poll detect changes on the picked element.
- **UX**: Save button shows live change count ("Save 4 changes"). Diff review panel before write.
- **Mapping intelligence**: deterministic core. The CSS → Tailwind class mapper handles the supported property set without invoking any LLM. MCP server is a v1.5 escalation path for ambiguous cases.
- **License**: MIT.
- **Distribution**: npm scoped namespace `@shiage/*`, single GitHub repo as a pnpm monorepo.
- **Versioning**: starts at 0.1.0, stays on 0.x until the API is stable.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ USER'S DEV ENVIRONMENT                                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Browser (Chrome)                                        │    │
│  │                                                         │    │
│  │ ┌────────────────────────────┐  ┌────────────────────┐ │    │
│  │ │ User's app                 │  │ Chrome DevTools    │ │    │
│  │ │ (each element stamped      │  │ (where user edits  │ │    │
│  │ │  with data-shiage-loc)     │◀─│  CSS values)       │ │    │
│  │ │                            │  └────────────────────┘ │    │
│  │ │ ┌────────────────────────┐ │                         │    │
│  │ │ │ Shiage runtime         │ │                         │    │
│  │ │ │ (injected; Shadow DOM) │ │                         │    │
│  │ │ │ - Overlay + pick UI    │ │                         │    │
│  │ │ │ - Watcher (Mutation +  │ │                         │    │
│  │ │ │   500ms poll)          │ │                         │    │
│  │ │ │ - Diff review panel    │ │                         │    │
│  │ │ └────────────────────────┘ │                         │    │
│  │ └─────────────┬──────────────┘                         │    │
│  └────────────── │ ─────────────────────────────────────  │    │
│                  │ WebSocket                                    │
│                  ▼                                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Vite or Next plugin (the npm package)                   │    │
│  │ - Build-time JSX transform (stamps data-shiage-loc)     │    │
│  │ - Tailwind config parser (reverse-lookup tables)        │    │
│  │ - WebSocket server                                      │    │
│  │ - CSS→Tailwind deterministic mapper                     │    │
│  │ - AST editor for JSX/TSX files                          │    │
│  └────────────────┬────────────────────────────────────────┘    │
│                   │ writes files                                │
│                   ▼                                             │
│  Source files → Vite/Next HMR → browser repaints                │
└─────────────────────────────────────────────────────────────────┘
```

### Component responsibilities

- **`@shiage/core`** — framework-agnostic logic: the CSS→Tailwind mapper, the AST editor, the WebSocket message protocol, the Tailwind config parser, the diff generator. Zero browser code.
- **`@shiage/runtime`** — the browser-side script. Shadow DOM overlay, pick mode, watcher, diff review panel, WebSocket client. Zero Node code.
- **`@shiage/vite`** — Vite plugin. Wires `core` to Vite's build pipeline and injects `runtime` in dev mode.
- **`@shiage/next`** — Next plugin. Same role as `@shiage/vite` for Next.js.
- **`@shiage/jsx-transform`** — the Babel/SWC transform that stamps `data-shiage-loc` attributes. Used by both plugins.

### Data flow (a single save)

1. User picks element. Runtime captures: source location, current className, computed styles for supported properties.
2. User edits CSS in DevTools. Runtime's MutationObserver + 500ms poll detect property changes against the baseline. Save button updates count.
3. User clicks save. Runtime sends `{ type: "save", sourceLoc, currentClassName, propertyChanges }` over WebSocket.
4. Plugin's server receives, calls `core.mapToTailwind(propertyChanges, tailwindConfig)` → list of class edits.
5. Plugin's server calls `core.editJsxFile(filePath, lineCol, classEdits)` → returns proposed file content + diff.
6. Server sends `{ type: "diff-preview", diff }` back to runtime.
7. Runtime shows diff in panel. User confirms.
8. Runtime sends `{ type: "apply" }`. Server writes file. Framework HMR triggers automatically.

---

## 5. Repo structure

```
shiage/
├── packages/
│   ├── core/                  # @shiage/core
│   │   ├── src/
│   │   │   ├── mapper/        # CSS → Tailwind class mapping
│   │   │   ├── ast/           # JSX/TSX AST editing
│   │   │   ├── tailwind/      # Tailwind config parsing
│   │   │   ├── protocol/      # WebSocket message types
│   │   │   └── diff/          # Diff generation
│   │   ├── tests/
│   │   └── package.json
│   ├── runtime/               # @shiage/runtime (browser)
│   │   ├── src/
│   │   │   ├── overlay/       # Shadow DOM UI
│   │   │   ├── picker/        # Pick mode logic
│   │   │   ├── watcher/       # Change detection
│   │   │   └── client/        # WS client
│   │   └── package.json
│   ├── jsx-transform/         # @shiage/jsx-transform
│   ├── vite/                  # @shiage/vite
│   └── next/                  # @shiage/next
├── examples/
│   ├── vite-react/            # Minimal Vite + React + Tailwind demo app
│   └── next-app/              # Minimal Next.js + Tailwind demo app
├── docs/                      # (optional, can defer to v0.2)
├── .changeset/
├── .github/
│   └── workflows/
├── pnpm-workspace.yaml
├── package.json
├── LICENSE
└── README.md
```

Use **pnpm workspaces** for the monorepo (not yarn or npm workspaces — pnpm is the de facto standard for this kind of project and handles peer dependency hoisting better). Use **Changesets** for versioning.

---

## 6. Phases

Each phase is sized so a solo developer working with Claude Code can complete it in roughly the time noted. Times assume working sessions, not calendar weeks.

### Phase 0 — Setup (1–2 days)

**Goal:** Have a clean, empty monorepo skeleton with all the tooling in place so subsequent phases can focus on logic.

**Deliverables:**
- GitHub repo created (public).
- `LICENSE` file (MIT).
- `pnpm-workspace.yaml` with `packages/*` glob.
- Root `package.json` with `private: true`.
- TypeScript configured (strict mode) with a shared `tsconfig.base.json`.
- ESLint + Prettier set up at the root.
- Empty package skeletons for `core`, `runtime`, `jsx-transform`, `vite`, `next` (each with their own `package.json` and `tsconfig.json` extending root).
- Vitest set up for unit tests.
- GitHub Actions workflow: on PR, run `pnpm install && pnpm test && pnpm lint`.
- Changesets initialized: `pnpm dlx @changesets/cli init`.

**Tricky bits:**
- Make sure each package's `package.json` declares `"type": "module"` and configures `main`, `module`, `types`, and `exports` correctly. Look at Vite's own package.json for reference.
- `@shiage/runtime` is special — it gets built as a single browser-targeted bundle, not a Node module. Use `tsup` with `format: ["iife"]` to produce a single inlinable JS file.

**Acceptance criteria:** `pnpm install` succeeds from a clean clone. `pnpm test` passes (no tests yet, but the runner works). Pushing a commit triggers CI green.

**Starter Claude Code prompt:**
> *"Set up a pnpm workspaces monorepo at the current directory with packages named core, runtime, jsx-transform, vite, and next. Each package should be TypeScript (strict mode), with vitest configured. Add ESLint and Prettier at the root with sensible defaults. Add a GitHub Actions workflow that installs, lints, and tests on pull requests. Set up Changesets for versioning. The runtime package should be configured to build with tsup as a single IIFE bundle for browsers. All other packages build as ESM Node modules."*

---

### Phase 1 — The CSS → Tailwind mapper (1 week)

**Goal:** Given `{ paddingLeft: "16px" → "24px", color: "rgb(59, 130, 246)" → "rgb(239, 68, 68)" }` and the user's Tailwind config, produce `[{ remove: "pl-4", add: "pl-6" }, { remove: "text-blue-500", add: "text-red-500" }]`.

This is the most important and most-unknown piece. Build it first and build it solid. Everything else is plumbing.

**Deliverables (all in `packages/core/src/mapper/` and `packages/core/src/tailwind/`):**
- `parseTailwindConfig(configPath)` — loads the user's `tailwind.config.{js,ts,mjs}`, executes it, returns the resolved theme object.
- `buildReverseLookup(theme)` — produces lookup tables: `spacingByPx`, `colorsByRgb`, `radiusByPx`, `fontSizeByPx`, etc.
- `findClassForProperty(property, value, lookup)` — given `("padding-left", "24px")`, returns `"pl-6"` (or `"pl-[24px]"` if no scale match, or `null` if not mappable).
- `classProducingProperty(className, property)` — given `"p-4 bg-blue-500 rounded-lg"` and property `"padding-left"`, returns the substring class `"p-4"` (since `p-*` affects padding-left).
- A complete unit test suite covering every supported property × Tailwind config variant.

**Tricky bits:**
- Tailwind's directional shorthand: `p-4` means `padding: 16px` on all sides, `px-4` only on x-axis, `pl-4` only on left. When DevTools reports `padding-left` changed, we need to decide whether to edit `p-4` (which also changes the other 3 sides — probably wrong) or replace with `pl-4` + leftover `pr-4 pt-4 pb-4` (correct but ugly). Heuristic: if the change is to one direction only, prefer specific direction class.
- Arbitrary values: when there's no exact match, fall back to `p-[23px]` syntax. Document this clearly so users understand why some changes produce arbitrary brackets.
- Custom theme extensions: Tailwind users often add custom spacing scales. The parser must respect `theme.extend`.
- Important: do not import the user's `tailwind.config.js` directly — execute it in a child Node process via `vm` or `jiti` so type-stripping and ESM works correctly. `jiti` is the Tailwind-blessed loader.

**Acceptance criteria:**
- Given a real Tailwind project's config, the mapper correctly translates 95%+ of v1-scope property changes to canonical Tailwind classes.
- For unmappable values, it produces arbitrary-value syntax.
- All unit tests pass.

**Starter Claude Code prompt:**
> *"In packages/core/src/tailwind/, implement parseTailwindConfig that takes a path to a tailwind.config.{js,ts,mjs} file, loads it using jiti, executes it, and returns the resolved theme object (apply the default Tailwind theme defaults then merge user extensions). Then implement buildReverseLookup(theme) that returns an object with these keys: spacingByPx (Map of px string → class suffix like '4', '6'), colorsByRgb (Map of 'rgb(r,g,b)' → color name like 'blue-500'), radiusByPx, fontSizeByPx, fontWeightByValue, lineHeightByPx, opacityByValue. Write Vitest unit tests covering the default Tailwind theme and a config with custom theme.extend.spacing."*

> *"In packages/core/src/mapper/, implement findClassForProperty(property: string, newValue: string, lookup: ReverseLookup): string | null that returns the Tailwind class (e.g., 'pl-6', 'text-red-500', 'rounded-lg') corresponding to the value, or a Tailwind arbitrary-value class (e.g., 'pl-[23px]') if no scale match, or null if the property is not in the v1 supported set. The v1 supported set is in the file SUPPORTED_PROPERTIES.md at the repo root — load it as a reference. Write tests covering: exact scale match, arbitrary value fallback, unsupported property."*

---

### Phase 2 — The JSX/TSX AST editor (4–5 days)

**Goal:** Given `App.tsx`, line 42, and class edits `[{ remove: "pl-4", add: "pl-6" }]`, rewrite the file with the change applied.

**Deliverables (all in `packages/core/src/ast/`):**
- `parseJsxFile(content)` — uses `@babel/parser` to produce an AST.
- `findElementAtLine(ast, line, col)` — locates the JSX element node.
- `findClassNameValue(elementNode)` — extracts the className prop, handling: string literal, expression with `cn()`/`clsx()` call, template literal, conditional expression.
- `applyClassEdits(classNameNode, edits)` — produces a new node with classes added/removed.
- `serializeAndWrite(ast, filePath)` — uses `@babel/generator` (with `retainLines: true`) to write back, preserving formatting as much as possible.
- Unit tests covering the common className patterns.

**Tricky bits:**
- Formatting preservation is hard. Babel's generator can mangle whitespace. Consider using `magic-string` or `recast` instead, which preserve original source between edited nodes. `magic-string` is the right call for this kind of surgical edit.
- Conditional classNames (`cn("p-4", isActive && "p-6")`) — if the v1 supported edit is to a static string class, we edit only the static portion. If the user tries to edit a conditionally-applied class, the diff review should warn and offer to skip.
- `className={styles.foo}` (CSS Modules pattern) — out of scope for v1. Detect and show a "this element uses CSS Modules, not yet supported" message.
- Variables: `className={buttonClasses}` where `buttonClasses` is defined elsewhere. v1: detect and warn, don't try to follow.

**Acceptance criteria:**
- Editing a string-literal className produces a diff that changes only the className value.
- Original file formatting (indentation, surrounding code) is preserved.
- Unsupported className patterns produce clear "not supported" results, not garbage edits.

**Starter Claude Code prompt:**
> *"In packages/core/src/ast/, implement editJsxFile(filePath: string, line: number, col: number, classEdits: ClassEdit[]). Use @babel/parser to parse, then use magic-string to perform surgical text replacement on the className string literal at the located element. Support: (1) className as plain string literal — direct edit. (2) className as a call to cn() or clsx() with string literal arguments — edit the matching string literal argument. (3) className as a template literal with no expressions — edit the literal. For any other shape (variable reference, computed expression, dynamic conditional), return { kind: 'unsupported', reason: string } without modifying the file. Write tests for each case."*

---

### Phase 3 — JSX source-location stamping (2–3 days)

**Goal:** When the user's project is built in dev mode, every JSX element in the DOM has a `data-shiage-loc="Card.tsx:42:8"` attribute.

**Deliverables (in `packages/jsx-transform/`):**
- A Babel plugin that visits every `JSXOpeningElement` and inserts a `JSXAttribute` for `data-shiage-loc` with the value `${filename}:${line}:${column}`.
- An equivalent SWC plugin shape (Next.js's Turbopack uses SWC; this can come second).
- The transform runs only in dev mode (production builds strip these attrs).
- Tests using `@babel/core` programmatically to verify the transform output.

**Tricky bits:**
- The transform must run *before* React's own JSX → React.createElement transform, so the inserted attribute is preserved.
- Don't stamp `<Fragment>` or `<>` — they don't have DOM presence.
- Don't stamp components (uppercase tags) — only host elements (lowercase like `div`, `button`). The component's *output* will be stamped when the component renders its own host elements.
- File paths in the attribute should be relative to the project root, not absolute (privacy + repo portability).

**Acceptance criteria:**
- A simple `<button className="p-4">x</button>` in `Card.tsx` at line 42 produces a button in the live DOM with `data-shiage-loc="Card.tsx:42:8"`.
- Production builds (`pnpm build`) strip the attribute.

**Starter Claude Code prompt:**
> *"In packages/jsx-transform/, write a Babel plugin that adds a data-shiage-loc attribute to every JSXOpeningElement whose name is a lowercase identifier (host elements only, not components). The value should be `${relativePath}:${line}:${column}` where relativePath is the file path relative to the project root. Skip if the attribute already exists. The plugin should accept options: { projectRoot: string, enabled: boolean }. Write unit tests using @babel/core to transform sample code and check the output."*

---

### Phase 4 — Browser runtime: overlay, picker, watcher, diff panel (1.5 weeks)

**Goal:** Everything that runs in the user's browser tab during development.

**Deliverables (in `packages/runtime/`):**
- A self-mounting script that runs on page load, creates a Shadow DOM host, mounts the overlay.
- Overlay UI in the corner: small button → expands to panel showing picked element + change count + save button + diff review.
- **Picker logic**: enters pick mode, draws element outline on hover, captures click, resolves nearest-source-loc ancestor.
- **Baseline snapshot**: at pick time, captures computed styles for the v1 supported property set, plus className, plus tag name, plus source-loc.
- **Watcher**: MutationObserver on `style` attribute + setInterval(500ms) calling `getComputedStyle` and diffing against baseline.
- **Diff review panel**: shows source code diff (before/after className strings), with a confirm button.
- **WebSocket client**: connects to the local server, sends save requests, receives diff previews.
- Cleanup logic: on HMR full-reload, gracefully re-mount.

**Tricky bits:**
- Shadow DOM is non-negotiable. The user's CSS (Tailwind preflight, global resets) will mangle any DOM you put in the page directly. Use `<div>.attachShadow({ mode: "closed" })`.
- The runtime ships as a single IIFE bundle (no module loading at runtime). Use `tsup` with `format: ["iife"]`.
- For the diff panel, you'll need a lightweight diff renderer. Use `diff` (the npm package) for the algorithm, render line-by-line as DOM. Avoid heavy diff libraries.
- HMR will sometimes wipe your DOM. Detect this and re-mount. Persist the picked element by `data-shiage-loc` so it survives HMR.
- The "ignore our own elements during pick" rule: stamp the shadow host with a known data attr and check `event.target.closest('[data-shiage-host]')` before processing pick clicks.

**Acceptance criteria:**
- Open a demo app. Click the overlay. Click an element. The element gets a highlight. Open DevTools, change padding from 16px to 24px. The overlay button changes to "Save 1 change." Click save. Diff panel shows the proposed className edit. Confirm. The file on disk is updated.

**Starter Claude Code prompts (this phase is bigger; multiple prompts):**

Prompt 1:
> *"In packages/runtime/src/, write a Shadow DOM-based overlay. On import, it should: (1) create a div with attribute data-shiage-host, append it to document.body, attach a closed shadow root. (2) inside the shadow root, render a small floating button in the bottom-right corner ('Shiage'). (3) when clicked, expand to a panel that displays 'no element picked' initially. Use vanilla TS, no framework. All styles inline via a single `<style>` tag inside the shadow root."*

Prompt 2:
> *"Add a picker module. When 'Pick element' is clicked in the overlay, attach mousemove and click listeners to document. On mousemove, get the element under cursor via document.elementFromPoint, draw a colored outline on it (use a separate Shadow DOM element with absolute positioning and pointer-events: none). Ignore the shiage host element. On click, capture the element, resolve nearest ancestor with data-shiage-loc (walk up the tree), and pass it to a callback. Esc cancels."*

Prompt 3:
> *"Add a watcher module that takes a picked element. On start, snapshot its computed styles for the v1 property set [list the properties here from SUPPORTED_PROPERTIES.md], plus its current className and data-shiage-loc. Then start: (1) a MutationObserver watching the element's style attribute, and (2) a setInterval(500) that calls getComputedStyle and diffs against the baseline. Expose a getCurrentChanges() method returning {property, oldValue, newValue}[]."*

---

### Phase 5 — WebSocket protocol and Vite plugin (1 week)

**Goal:** The Vite plugin boots a WS server, injects the runtime, applies the JSX transform, and routes save requests through the mapper + AST editor to the filesystem.

**Deliverables (in `packages/vite/`):**
- A Vite plugin (default export) that:
  - In `configResolved`: parses the user's tailwind config (via `@shiage/core`), starts a WebSocket server on a free port.
  - In `transform`: applies the JSX transform from `@shiage/jsx-transform` to `.tsx`/`.jsx` files in dev mode.
  - In `transformIndexHtml`: injects a `<script>` tag pointing to the bundled `@shiage/runtime` IIFE, plus a `<meta>` tag with the WS port number.
  - Routes WebSocket save requests through `core.mapToTailwind` + `core.editJsxFile`, sends diff preview back, writes file on confirmation.
- Define the WebSocket message protocol in `@shiage/core/src/protocol/`:
  ```ts
  type ClientMessage =
    | { type: "save"; sourceLoc: string; className: string; changes: PropertyChange[] }
    | { type: "apply"; saveId: string }
    | { type: "cancel"; saveId: string };
  
  type ServerMessage =
    | { type: "diff-preview"; saveId: string; diff: SourceDiff; warnings: string[] }
    | { type: "apply-result"; saveId: string; success: boolean; error?: string }
    | { type: "config-reloaded" };
  ```

**Tricky bits:**
- The WebSocket port must not collide with Vite's own. Pick a free port via `node:net.createServer().listen(0)` and pass it to the runtime via the injected `<meta>`.
- Tailwind config reload: watch the tailwind config file. If it changes, re-parse and broadcast `config-reloaded` to connected clients.
- Don't run the JSX transform on `node_modules`. Filter the `transform` hook by `id.includes("node_modules") === false`.
- Production build: the plugin should be a no-op entirely. Check `command === "serve"` or `config.command === "serve"`.

**Acceptance criteria:**
- Install the plugin into the `examples/vite-react/` example app. Run `pnpm dev`. Open the page. Pick an element, edit padding in DevTools, save. The source file is updated. HMR repaints the browser.

**Starter Claude Code prompt:**
> *"In packages/vite/src/, write a Vite plugin that integrates @shiage/core, @shiage/runtime, and @shiage/jsx-transform. Read packages/core/src/protocol/ for the WebSocket message types. In dev mode only: (1) parse the user's tailwind.config and build reverse-lookup tables, (2) start a WS server on a free port, (3) transform JSX/TSX files to inject data-shiage-loc attributes, (4) inject the runtime IIFE bundle into index.html along with a meta tag containing the WS port. Handle save messages by calling core.findClassForProperty and core.editJsxFile, then sending back a diff-preview. On apply, write the file using fs.writeFile. Reject and warn for unsupported className patterns."*

---

### Phase 6 — Next.js plugin (4–5 days)

**Goal:** Same as the Vite plugin, but for Next.js.

**Deliverables (in `packages/next/`):**
- A `withShiage` function that wraps a `next.config.js`:
  ```js
  const withShiage = require('@shiage/next');
  module.exports = withShiage({ /* user config */ });
  ```
- It modifies the webpack config to add the JSX transform as a loader rule.
- It injects the runtime script into the app via a custom Next.js plugin or by writing to `_document.tsx`.
- It runs the same WebSocket server as the Vite plugin (logic in `@shiage/core`, reused).
- Handle both Pages Router and App Router.
- Turbopack support is **v1.1** (skip for v1 — too unstable an API to chase).

**Tricky bits:**
- Next.js has its own SWC-based JSX transform. Coexisting with it requires running our Babel transform either before or via SWC plugin (more complex).
- App Router vs Pages Router differs in how scripts are injected.
- Next.js dev server doesn't expose a clean "boot hook" like Vite — you might need to start the WS server in a separate process or use Next's `instrumentation.ts` hook.

**Acceptance criteria:**
- `examples/next-app/` runs `pnpm dev` and the same pick → edit → save flow works as in Vite.

---

### Phase 7 — Docs, demo, launch (1–2 weeks)

**Goal:** A README and example folder strong enough that a stranger lands on the repo, watches a 30-second video, and decides to try it within 5 minutes.

**Deliverables:**
- A great README with:
  - Hero GIF or short video (top of readme, before any text)
  - One-line description: *"Shiage — Inspect and edit CSS on Chrome. The Japanese word for finishing touches."*
  - 30-second install + use snippet for Vite and Next.js
  - Supported / unsupported properties section (see §7)
  - FAQ
  - Contributing pointer
  - License note
- Two working example apps in `examples/` — Vite-React-Tailwind, and Next-App-Router-Tailwind. Each should be a single command to clone and run.
- Demo video — record a 30–60 second screencast of the workflow. Tools: ScreenStudio, Cleanshot, or Loom. Put it in the README and on a YouTube/Vimeo backup.
- Launch posts:
  - HN Show HN (title: *"Show HN: Shiage – inspect and edit CSS in Chrome DevTools, save changes to source"*)
  - Twitter/X thread
  - Reddit r/reactjs, r/sideproject, r/nextjs
  - One DEV.to blog post: *"How I built Shiage with Claude Code: the deterministic CSS-to-Tailwind mapper"* — pulls in passive search traffic for months.

**Tricky bits:**
- The demo video is the single highest-ROI launch asset. Spend disproportionate time on it.
- Don't launch on a Friday. Tuesday or Wednesday morning Pacific time for HN.
- Be in the comments for at least the first 12 hours after posting. Reply to everyone.

---

## 7. Supported CSS properties (v1)

The mapper handles these properties. The watcher only flags changes for these. Anything else, Shiage shows a friendly "not supported in v1, edit your code directly" message.

### Supported (v1)

**Spacing**
- `padding`, `padding-top`, `padding-right`, `padding-bottom`, `padding-left`
- `margin`, `margin-top`, `margin-right`, `margin-bottom`, `margin-left`
- `gap`, `row-gap`, `column-gap`

**Sizing**
- `width`, `height`
- `min-width`, `min-height`, `max-width`, `max-height`

**Typography**
- `font-size`
- `font-weight`
- `line-height`
- `letter-spacing`
- `text-align`
- `color`

**Background**
- `background-color`

**Border**
- `border-width`, `border-top-width`, `border-right-width`, `border-bottom-width`, `border-left-width`
- `border-color`
- `border-radius`, `border-top-left-radius`, etc.
- `border-style` (limited: only `solid`, `dashed`, `dotted`, `none`)

**Effects**
- `opacity`
- `box-shadow` (only Tailwind preset shadows; arbitrary custom shadows fall through to arbitrary value syntax)

### Not supported in v1 (intentionally)

- `display` (changing flex / grid / block restructures layout in ways that often require source refactor, not just className edit)
- `position`, `top`, `right`, `bottom`, `left`, `z-index`
- `transform`, `transition`, `animation` (Tailwind classes for these are complex; v1.5)
- `grid-template-*`, `grid-area`, `flex-*` direction/wrap (layout restructures)
- Pseudo-class state edits (`:hover`, `:focus`, `:active`) — these would require Tailwind variant prefixes; v2
- Pseudo-elements (`::before`, `::after`)
- Media query / responsive variant edits — single biggest v2 feature
- Dark mode variant edits — v2
- CSS variable edits (`--color: ...`) — v2
- Anything inside `@media`, `@supports`, `@container`

### Not supported in v1 (won't fix in v1.x)

- CSS-in-JS (styled-components, Emotion, vanilla-extract)
- Inline `style={}` props (we always work through className for Tailwind; if the user uses `style={}`, we won't follow)
- Component prop classNames (e.g., `<Card className="..." />` — we edit the JSX, not the consumer's prop value yet)

Document this list prominently in the README. Underpromising is critical — users who hit an unsupported case should see a clear "not supported" message, not a broken edit.

---

## 8. Working with Claude Code (for solo build)

You are a product designer with minimal dev experience, building this solo with Claude Code as your pair-programmer. A few patterns that will keep this manageable:

### Use this plan as Claude Code's primary context

At the start of every session, point Claude Code at this file: `@SHIAGE_BUILD_PLAN.md`. Tell it which phase you're on. It will then know the architectural decisions, file structure, and what's expected.

### One phase at a time, then test before moving on

Don't try to build Phase 1 and Phase 2 in the same session. Finish Phase 1, write its tests, make sure they pass, commit, then start Phase 2. Phases later in the plan depend heavily on earlier phases being solid.

### Prompting patterns that work

- **Give Claude Code the file paths.** "Implement parseTailwindConfig in `packages/core/src/tailwind/config.ts`" works much better than "Implement the config parser."
- **Reference the supported properties list.** If you're working on the mapper, give Claude the SUPPORTED_PROPERTIES section of this plan. It will respect the scope.
- **Demand tests.** End every prompt with "Write Vitest unit tests covering [list of cases]." Otherwise tests get skipped, and the project's foundation gets fragile.
- **Ask Claude to explain its choices.** When you don't understand something, ask "Why did you choose [approach] here?" — you'll learn a lot and catch wrong-direction decisions early.

### What to delegate vs. think about yourself

**Delegate to Claude Code:**
- All implementation code
- Tests
- Boilerplate config (tsconfig, eslint, package.json)
- Refactoring
- Documentation drafts

**Think about yourself (don't just delegate):**
- Architectural decisions when they come up
- The UX of the overlay (you're the product designer — this is your zone)
- Naming things in user-facing copy
- Which warnings/errors to show users when something is unsupported
- The demo video script and shot list
- Launch messaging

### Skill suggestions

Once you're inside Claude Code, ask it to set up these skills (or check that they exist) at the start of the project:

- **A Tailwind reference skill** — point Claude at the Tailwind docs so it doesn't hallucinate class names.
- **A React + Vite skill** — for the example apps.
- A repo-specific `CLAUDE.md` file at the root that summarizes this plan and tells Claude to read it.

---

## 9. Pre-build checklist

Before writing a single line of code, do these in order:

1. **Verify availability** for `shiage` on npm directly: `npmjs.com/package/shiage`.
2. **Reserve the npm scope** `@shiage` (publish a 0.0.0 placeholder package to claim it). Enable 2FA on the npm account.
3. **Buy the domain** `shiage.dev` (and ideally `shiage.com` if available; check Namecheap or Cloudflare).
4. **Create the GitHub repo** named `shiage`. Set it to public from day 1 — building in public attracts traction.
5. **Add a basic README** with just the name, tagline, and "🚧 In active development" status. This is enough for any early visibility.
6. **Add the LICENSE file** (MIT).
7. **Save this plan** as `SHIAGE_BUILD_PLAN.md` at the repo root.
8. **Open Claude Code** in the repo directory, paste this plan as context, and start with Phase 0.

---

## 10. Open questions and known unknowns

These are intentionally not decided yet. Address when they become blocking.

- **The MCP server design.** Punted to v1.5. Will revisit once core + Vite plugin are working, when we have a real product to extend.
- **CSS Modules support.** v1.5. Architecture cleanly supports adding it later (new package `@shiage/css-modules` that plugs into the same core).
- **Pricing / monetization.** None for v1; pure OSS. Revisit if traction is real (hosted MCP service? Team features? Cloud-synced annotations? Don't speculate yet.).
- **Chrome extension.** v2 quality-of-life upgrade. Removes the pick step. Build only if usage data says pick friction is real.
- **Responsive breakpoint editing.** Biggest single feature for v2. Editing the `md:p-4` variant from a desktop browser window requires either DevTools device mode integration or a Shiage-side breakpoint switcher.

---

## Appendix: Locked positioning sentence

For the website hero, the GitHub README, the launch post, and any pitch: use exactly this wording. Consistent positioning compounds.

> **Shiage — Inspect and edit CSS on Chrome.**
>
> *Shiage (仕上げ) is Japanese for "finishing touches." Build the structure with your AI agent. Use Shiage for the last 5%.*
