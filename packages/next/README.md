# @shiage/next

Next.js plugin for [Shiage](https://shiage.dev) — inspect and edit CSS in Chrome DevTools,
save changes to source as Tailwind classes.

## Install

```bash
pnpm i -D @shiage/next
```

You'll also need Tailwind CSS (v3 or v4) somewhere in your Next build.

## Use

```js
// next.config.mjs
import withShiage from '@shiage/next'

/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true }

export default withShiage(nextConfig)
```

```tsx
// app/layout.tsx  (App Router)
import { ShiageDevScripts } from '@shiage/next'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ShiageDevScripts />
      </body>
    </html>
  )
}
```

`ShiageDevScripts` emits the inlined runtime + WS port `<meta>` in dev and renders `null` in
production. For the Pages Router, drop it inside `<body>` in `_document.tsx`.

## Webpack only (v0.1)

Turbopack ignores Next's `webpack()` callback, so the JSX source-location stamper Shiage
relies on never runs under Turbopack in v0.1.

- **Next 15.x** still defaults to webpack — plain `next dev` works.
- **Next 16+** defaults to Turbopack — run `next dev --webpack`.

If the runtime didn't boot you'll see a one-shot console warning explaining why.
Turbopack support is planned for v1.1.

## What's supported / not

See the [main README](https://github.com/horacechoi/shiage#whats-supported) for the
properties table, framework caveats, and FAQ.

## License

[MIT](https://github.com/horacechoi/shiage/blob/main/LICENSE) — © 2026 Horace Choi.
