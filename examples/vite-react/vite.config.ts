import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import shiage from '@shiage/vite'

// The Shiage plugin is serve-only and enforces 'pre', so it stamps source locations before
// @vitejs/plugin-react compiles the JSX away. Order in this array doesn't matter because of that.
export default defineConfig({
  plugins: [react(), tailwindcss(), shiage()],
})
