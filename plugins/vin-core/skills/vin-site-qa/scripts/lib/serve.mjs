// A tiny static file server for QA of a built site folder. Binds to 127.0.0.1 on a
// random port in 41000-49999 and refuses paths that escape the folder.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomPort } from './qa-core.mjs'

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
  '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.glb': 'model/gltf-binary'
}

/** Resolve a URL path inside root, or null if it escapes or does not exist. */
export function resolveInside (root, urlPath) {
  let p
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]) } catch { return null }
  if (p.includes('\0')) return null
  const abs = path.resolve(root, '.' + path.posix.normalize('/' + p))
  const rootAbs = path.resolve(root)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null
  const candidates = [abs, path.join(abs, 'index.html'), abs + '.html']
  for (const c of candidates) {
    try {
      const real = fs.realpathSync(c)
      if (real !== fs.realpathSync(rootAbs) && !real.startsWith(fs.realpathSync(rootAbs) + path.sep)) continue
      if (fs.statSync(real).isFile()) return real
    } catch {}
  }
  return null
}

export function serveFolder (root, { headers = {}, tries = 20 } = {}) {
  const server = http.createServer((req, res) => {
    const file = resolveInside(root, req.url || '/')
    if (!file) {
      const nf = resolveInside(root, '/404.html')
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', ...headers })
      return res.end(nf ? fs.readFileSync(nf) : 'not found')
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', ...headers })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve, reject) => {
    let n = 0
    const attempt = () => {
      const port = randomPort()
      server.once('error', (e) => { if (e.code === 'EADDRINUSE' && ++n < tries) attempt(); else reject(e) })
      server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}/`, port, close: () => new Promise(r => server.close(() => r())) }))
    }
    attempt()
  })
}
