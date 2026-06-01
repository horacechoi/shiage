# `@shiage-example/next-app`

A minimal Next.js (App Router) + Tailwind v4 demo for `@shiage/next`. Pick an element in the card,
tweak its CSS in Chrome DevTools, save — the change is written back to `app/page.tsx` as Tailwind
class edits.

## Run

```bash
pnpm --filter @shiage-example/next-app dev
# → http://localhost:3000
```

> **Webpack only.** Phase 6 of the Shiage build supports the webpack/Babel path; Turbopack is
> Phase 7+ work. Next 15.x defaults to webpack — `next dev` is enough. On Next 16, where
> Turbopack is the default, add `--webpack`: `next dev --webpack`. If you see a "[shiage] dev
> server not booted — Turbopack ignores webpack() config" warning in the console, that's why.

## Layout

- `next.config.mjs` — wraps the Next config with `withShiage(...)`. Adds the JSX-stamp loader rule
  and boots the Shiage WS server in dev.
- `app/layout.tsx` — drops `<ShiageDevScripts />` into the root layout's `<body>`. The component
  emits the `shiage-ws-port` meta + the inlined runtime IIFE in dev; null in production.
- `app/globals.css` — Tailwind v4 entry, plus a `--color-brand` theme token so the demo exercises
  the user's real theme (try editing the button's `background-color` in DevTools).
- `postcss.config.mjs` — wires Tailwind v4 via `@tailwindcss/postcss`.
