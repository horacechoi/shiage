// Minimal static file server (Node built-ins only) for previewing packages/runtime/preview.html.
// Resolves its root from import.meta.url rather than process.cwd() so it works under a restricted
// sandbox, and serves "/" as preview.html so the preview tool's root URL just works.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../packages/runtime', import.meta.url))
const port = Number(process.argv[2] ?? 4567)

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (urlPath === '/') urlPath = '/preview.html'
    const filePath = path.join(root, urlPath)
    if (!filePath.startsWith(root)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    const data = await readFile(filePath)
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`))
