// Standalone HTTP server for the GenCon proxy.
//
// Used by the desktop app's main process: it mounts the same shared route
// handler as the Vite plugin (gencon-routes.mjs) and additionally serves the
// built SPA from a static directory, so `/api/gencon/*` and the app share an
// origin. Unknown non-API paths fall back to index.html (SPA-style routing).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createGenconHandler } from './gencon-routes.mjs';

/** Minimal extension → Content-Type map for the built SPA's assets. */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Resolve a request path to an absolute file inside `staticDir`, or null if it
 * would escape that directory (path-traversal guard).
 */
function resolveStaticPath(staticDir, pathname) {
  // Strip the query/leading slash, then normalize. A normalized path that
  // climbs above the root starts with '..' or is exactly '..'.
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  if (rel === '..' || rel.startsWith(`..${sep}`)) return null;
  // Explicit containment check on the fully-resolved path: accept only the
  // staticDir itself or paths beneath it (rather than trusting normalize()
  // evaluation order alone). Symlinks *inside* staticDir are trusted — that
  // directory is the app's own build output.
  const root = resolve(staticDir);
  const resolved = resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + sep)) return null;
  return resolved;
}

/** Serve a static file (SPA fallback to index.html for unknown paths). */
async function serveStatic(staticDir, req, res) {
  const url = new URL(req.url, 'http://localhost');
  let filePath = resolveStaticPath(staticDir, url.pathname);
  if (filePath === null) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Forbidden');
    return;
  }
  // '/' and extensionless paths are SPA routes → serve index.html.
  if (url.pathname === '/' || extname(filePath) === '') {
    filePath = join(staticDir, 'index.html');
  }
  let body;
  try {
    body = await readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      // Missing asset → fall back to the SPA shell.
      try {
        body = await readFile(join(staticDir, 'index.html'));
        filePath = join(staticDir, 'index.html');
      } catch {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not Found');
        return;
      }
    } else {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Internal Server Error');
      return;
    }
  }
  res.statusCode = 200;
  res.setHeader(
    'Content-Type',
    CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  );
  res.end(body);
}

/**
 * Start the standalone GenCon HTTP server.
 *
 * @param {object} opts
 * @param {number} opts.port       Port to listen on (0 = an OS-assigned port).
 * @param {string} [opts.host]     Interface to bind to; defaults to loopback
 *                                 ('127.0.0.1') so the server is never exposed
 *                                 beyond the local machine.
 * @param {string} opts.cacheDir   Root of the writable on-disk cache.
 * @param {string} opts.bundlePath Read-only seed file (the bundled events.json).
 * @param {string} opts.staticDir  Directory of the built SPA to serve.
 * @returns {import('node:http').Server} the listening server.
 */
export function startGenconServer({
  port,
  host = '127.0.0.1',
  cacheDir,
  bundlePath,
  staticDir,
}) {
  const apiHandler = createGenconHandler({ cacheDir, bundlePath });
  const server = createServer((req, res) => {
    if (req.url && req.url.startsWith('/api/gencon/')) {
      // The handler ends the response for API routes; no `next` is passed.
      apiHandler(req, res);
      return;
    }
    serveStatic(staticDir, req, res).catch((err) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(err?.message ?? String(err));
    });
  });
  server.listen(port, host);
  return server;
}
