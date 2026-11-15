import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { SERVER_PORT, WS_PATH } from '../shared/src/constants.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve workspace `assets/` under `/assets/*` without copying vendor PNGs into `public/`. */
function serveWorkspaceAssets(): Plugin {
  const assetsRoot = path.resolve(import.meta.dirname, '../../assets');

  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const rawUrl = req.url ?? '';
    if (!rawUrl.startsWith('/assets/')) {
      next();
      return;
    }

    const pathname = rawUrl.split('?')[0] ?? '';
    let decoded = '';
    try {
      decoded = decodeURIComponent(pathname.slice('/assets/'.length));
    } catch {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    const resolved = path.resolve(assetsRoot, decoded);
    if (resolved !== assetsRoot && !resolved.startsWith(assetsRoot + path.sep)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(resolved);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isFile()) {
      next();
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(stat.size));
    fs.createReadStream(resolved).pipe(res);
  };

  return {
    name: 'serve-workspace-assets',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [serveWorkspaceAssets()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      [WS_PATH]: { target: `ws://localhost:${SERVER_PORT}`, ws: true },
    },
  },
});
