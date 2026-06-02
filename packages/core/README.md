# @shiage/core

Framework-agnostic core for [Shiage](https://shiage.dev): the version-agnostic
CSS→Tailwind mapper, the JSX AST editor, the WebSocket protocol types, the diff
generator, and the Node-side dev-server plumbing.

> **Most users want [`@shiage/vite`](https://www.npmjs.com/package/@shiage/vite) or
> [`@shiage/next`](https://www.npmjs.com/package/@shiage/next)** — those depend on this
> package and wire it into a real framework dev server. Install `@shiage/core` directly
> only if you're building a new framework adapter.

## What's inside

- `tailwind/` — the `ThemeSource` abstraction over Tailwind v3 and v4. v4 drives
  `__unstable__loadDesignSystem` from `@tailwindcss/node` and inverts its
  `candidatesToCss` / `getClassList` output; v3 is shimmed from `jiti` +
  `tailwindcss/resolveConfig`. Same downstream behavior on both.
- `mapper/` — `mapChangesToClassEdits(changes, className, lookup, source)` — the
  shorthand-aware mapper that produces the class edits the AST editor applies.
- `ast/` — `editJsxFile(filePath, line, col, edits)` — locates an element by its
  stamped `data-shiage-loc` and rewrites its `className` via `magic-string` (never
  regenerates JSX, so formatting is preserved).
- `protocol/` — `ClientMessage`, `ServerMessage`, `PROTOCOL_VERSION`. Browser-safe;
  zero Node code. Imported from the runtime via the `./protocol` subpath.
- `supported` — `SUPPORTED_PROPERTIES` + `SUPPORTED_PROPERTY_LIST`. Single source of
  truth that drives [`SUPPORTED_PROPERTIES.md`](https://github.com/horacechoi/shiage/blob/main/SUPPORTED_PROPERTIES.md).
- `server/` — `startWsServer`, `wireProtocol`, `startShiageServer` — Node-only
  plumbing reused by the Vite and Next plugins.

`@shiage/core` has `"sideEffects": false` so the runtime can tree-shake-import the
browser-safe subpaths into its IIFE without pulling Node code.

## License

[MIT](https://github.com/horacechoi/shiage/blob/main/LICENSE) — © 2026 Horace Choi.
