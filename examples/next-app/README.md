# `@shiage-example/next-app`

A minimal Next.js (App Router) + Tailwind v4 demo for `@shiage/next`. Pick an element
in the card, tweak its CSS in Chrome DevTools, save — the change is written back to
`app/page.tsx` as Tailwind class edits.

## Run

```bash
pnpm install          # from the repo root
pnpm -r build         # build @shiage/runtime (the plugin inlines its IIFE)
pnpm --filter @shiage-example/next-app dev
# → http://localhost:3000
```

> **Webpack only.** v0.1 supports the webpack/Babel path; Turbopack is v1.1 work. Next
> 15.x defaults to webpack — plain `next dev` is enough. On Next 16+ (Turbopack default),
> pass `--webpack`: `next dev --webpack`. If you see a "[shiage] dev server not booted —
> Turbopack ignores webpack() config" warning in the console, that's why.

### Try it

1. Open <http://localhost:3000> in Chrome.
2. Click the **Shiage pill** (bottom-right of the page).
3. Pick the button that says *"Pick me & tweak my padding."*
4. In Chrome DevTools, edit the button's `padding` from `0.5rem 1rem` to
   `0.75rem 1.5rem`.
5. The pill should read **"Save 2 changes."** Click it.
6. The diff panel previews `px-4 py-2` → `px-6 py-3`. Click **Confirm**.
7. Check [`app/page.tsx`](app/page.tsx) — the className is updated and HMR has already
   repainted the browser.

## Layout

- [`next.config.mjs`](next.config.mjs) — wraps the Next config with `withShiage(...)`.
  Adds the JSX-stamp loader rule and boots the Shiage WS server in dev.
- [`app/layout.tsx`](app/layout.tsx) — drops `<ShiageDevScripts />` into the root
  layout's `<body>`. The component emits the `shiage-ws-port` meta + the inlined
  runtime IIFE in dev; `null` in production.
- [`app/globals.css`](app/globals.css) — Tailwind v4 entry, plus a `--color-brand`
  theme token so the demo exercises the user's real theme (try editing the button's
  `background-color` in DevTools).
- [`postcss.config.mjs`](postcss.config.mjs) — wires Tailwind v4 via `@tailwindcss/postcss`.
