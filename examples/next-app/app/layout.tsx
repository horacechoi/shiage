// Root layout — the App Router's top-level shell. `<ShiageDevScripts />` is a server-only sliver
// that emits the shiage-ws-port meta + the inlined runtime IIFE in dev and renders null in
// production (or when Turbopack is active and our webpack() callback never ran).
import { ShiageDevScripts } from '@shiage/next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'Shiage · Next.js demo',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ShiageDevScripts />
      </body>
    </html>
  )
}
