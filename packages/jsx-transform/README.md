# @shiage/jsx-transform

Babel plugin for [Shiage](https://shiage.dev) — stamps `data-shiage-loc` source-location
attributes onto JSX host elements during dev so the browser runtime can identify which
file, line, and column an element came from.

> **You almost never use this directly.** The
> [`@shiage/vite`](https://www.npmjs.com/package/@shiage/vite) and
> [`@shiage/next`](https://www.npmjs.com/package/@shiage/next) plugins wire this in
> for you. Use it standalone only if you're building a new Shiage framework adapter.

## What it does

- Visits `JSXOpeningElement` and stamps `data-shiage-loc="${relPath}:${line}:${col}"`.
- **Lowercase host elements only** — skips uppercase React components,
  `JSXFragment`, and `JSXMemberExpression`.
- Skips elements that already have the attribute (idempotent across passes).
- Paths are relative to `projectRoot` (privacy + portability across machines).
- Must run **before** React's JSX transform.

## Options

```ts
{
  projectRoot: string   // required; used to compute relative paths
  enabled?: boolean     // default true in dev; set false to disable
}
```

## Conventions to know

- `data-shiage-loc` line/column are **1-based** by Shiage convention. Babel's
  `loc.start.column` is 0-based, so this plugin adds one. The mapper in
  [`@shiage/core`](https://www.npmjs.com/package/@shiage/core) subtracts one when
  resolving back into the AST.
- Production builds disable the stamp; built output has no `data-shiage-loc` attrs.

## License

[MIT](https://github.com/horacechoi/shiage/blob/main/LICENSE) — © 2026 Horace Choi.
