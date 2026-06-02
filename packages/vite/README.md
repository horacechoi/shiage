# @shiage/vite

Vite plugin for [Shiage](https://shiage.dev) — inspect and edit CSS in Chrome DevTools,
save changes to source as Tailwind classes.

## Install

```bash
pnpm i -D @shiage/vite
```

You'll also need Tailwind CSS (v3 or v4) somewhere in your build.

## Use

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

That's it. Run `pnpm dev`, open your site, then edit any element's CSS in real Chrome
DevTools (right-click → Inspect). Shiage picks the change up automatically — no element to
"pick" first — and the pill (bottom-right) shows "Save N changes." Click **Save**: the
diff panel shows the proposed Tailwind class edit, confirming rewrites the source file on
disk, HMR repaints.

The plugin is `apply: 'serve'` and `enforce: 'pre'`. It's a true no-op in production
builds and stamps source locations before `@vitejs/plugin-react` compiles the JSX away
(so plugin order doesn't matter).

## Options

`shiage()` accepts none in v0.1 — sensible defaults out of the box. Detection of Tailwind
v3 vs v4 is automatic.

## What's supported / not

See the [main README](https://github.com/horacechoi/shiage#whats-supported) and
[`SUPPORTED_PROPERTIES.md`](https://github.com/horacechoi/shiage/blob/main/SUPPORTED_PROPERTIES.md)
for the full list, plus FAQ.

## License

[MIT](https://github.com/horacechoi/shiage/blob/main/LICENSE) — © 2026 Horace Choi.
