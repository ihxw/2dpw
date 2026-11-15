import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  SERVER_PORT,
  TICK_RATE,
  WS_PATH,
  decode,
  encode,
  type C2S,
  type S2C,
} from '@2dpw/shared';
import { Store, type AuthResult } from './db/Store.ts';
import { World } from './world/World.ts';

const port = Number(process.env.PORT ?? SERVER_PORT);
const host = process.env.HOST ?? '0.0.0.0';
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const assetsRoot = path.join(repoRoot, 'assets');
const clientDistRoot = path.join(repoRoot, 'packages/client/dist');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Serve a static file from `rootDir` while blocking directory traversal. */
function serveFileFromRoot(
  rootDir: string,
  relPath: string,
  res: ServerResponse,
  headOnly = false,
): boolean {
  const normalized = path.resolve(rootDir);
  const resolved = path.resolve(normalized, relPath);
  if (resolved !== normalized && !resolved.startsWith(normalized + path.sep)) {
    return false;
  }

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(resolved);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) return false;

  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
    'content-length': String(stat.size),
  });
  if (headOnly) {
    res.end();
  } else {
    fs.createReadStream(resolved).pipe(res);
  }
  return true;
}

function handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
  const rawUrl = req.url ?? '/';
  const pathname = rawUrl.split('?')[0] ?? '/';
  const headOnly = req.method === 'HEAD';

  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessions: sessions.size, players: world.size }));
    return;
  }

  if (req.method !== 'GET' && !headOnly) {
    res.writeHead(404).end();
    return;
  }

  if (pathname.startsWith('/assets/')) {
    let assetRel = '';
    try {
      assetRel = decodeURIComponent(pathname.slice('/assets/'.length));
    } catch {
      res.writeHead(400).end('Bad Request');
      return;
    }
    if (serveFileFromRoot(assetsRoot, assetRel, res, headOnly)) return;
  }

  let distRel = '';
  try {
    distRel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  if (serveFileFromRoot(clientDistRoot, distRel, res, headOnly)) return;
  if (!path.extname(distRel) && serveFileFromRoot(clientDistRoot, 'index.html', res, headOnly)) {
    return;
  }

  res.writeHead(404).end();
}

interface Session {
  id: string;
  ws: WebSocket;
  greeted: boolean;
  accountId?: string;
  username?: string;
  token?: string;
}

const sessions = new Map<string, Session>();
const store = new Store();
const world = new World(undefined, store);

function send(s: Session, msg: S2C): void {
  if (s.ws.readyState === s.ws.OPEN) s.ws.send(encode(msg));
}

function applyAuthResult(s: Session, res: AuthResult): void {
  if (!res.ok) {
    send(s, { t: 'authError', message: res.message });
    return;
  }
  s.accountId = res.accountId;
  s.username = res.username;
  s.token = res.token;
  send(s, { t: 'authOk', username: res.username, token: res.token, characters: res.characters });
}

function handle(s: Session, msg: C2S): void {
  switch (msg.t) {
    case 'hello':
      if (msg.version !== PROTOCOL_VERSION) {
        send(s, { t: 'error', code: 'version', message: `server protocol ${PROTOCOL_VERSION}` });
        s.ws.close();
        return;
      }
      s.greeted = true;
      send(s, { t: 'welcome', version: PROTOCOL_VERSION, sessionId: s.id, serverTime: Date.now() });
      return;
    case 'ping':
      send(s, { t: 'pong', at: msg.at, serverTime: Date.now() });
      return;
    case 'register':
      applyAuthResult(s, store.register(msg.username, msg.password));
      return;
    case 'login':
      applyAuthResult(s, store.login(msg.username, msg.password));
      return;
    case 'resume': {
      world.leave(s.id);
      const verified = store.verifyToken(msg.token);
      if (!verified) {
        send(s, { t: 'authError', message: '登录会话已失效，请重新登录' });
        return;
      }
      s.accountId = verified.accountId;
      s.username = verified.username;
      s.token = msg.token;
      send(s, {
        t: 'authOk',
        username: verified.username,
        token: msg.token,
        characters: store.listCharacters(verified.accountId),
      });
      return;
    }
    case 'logout':
      world.leave(s.id);
      if (s.token) store.revokeToken(s.token);
      s.accountId = undefined;
      s.username = undefined;
      s.token = undefined;
      return;
    case 'createCharacter': {
      if (!s.accountId) {
        send(s, { t: 'authError', message: '请先登录账号' });
        return;
      }
      const created = store.createCharacter(s.accountId, msg, world.getDefaultSpawn());
      if (!created.ok) {
        send(s, { t: 'authError', message: created.message });
        return;
      }
      send(s, { t: 'characterList', characters: store.listCharacters(s.accountId) });
      return;
    }
    case 'deleteCharacter': {
      if (!s.accountId) {
        send(s, { t: 'authError', message: '请先登录账号' });
        return;
      }
      store.deleteCharacter(s.accountId, msg.charId);
      send(s, { t: 'characterList', characters: store.listCharacters(s.accountId) });
      return;
    }
    case 'enterWorld': {
      if (!s.accountId) {
        send(s, { t: 'authError', message: '请先登录账号' });
        return;
      }
      const char = store.getCharacter(msg.charId, s.accountId);
      if (!char) {
        send(s, { t: 'authError', message: '未找到指定角色' });
        return;
      }
      world.joinCharacter(s.id, char, (out) => send(s, out));
      return;
    }
    case 'useBagItem':
      world.useBagItem(s.id, msg.slot);
      return;
    case 'join':
      world.join(s.id, msg, (out) => send(s, out));
      return;
    case 'move':
      world.move(s.id, msg);
      return;
    case 'setPreset':
      world.setPreset(s.id, msg.presetId);
      return;
    case 'teleport':
      world.teleport(s.id, msg.mapId);
      return;
  }
}

const http = createServer(handleHttpRequest);

const wss = new WebSocketServer({ server: http, path: WS_PATH });

wss.on('connection', (ws) => {
  const s: Session = { id: randomUUID(), ws, greeted: false };
  sessions.set(s.id, s);
  console.log(`[net] + ${s.id} (${sessions.size} online)`);

  ws.on('message', (data) => {
    const msg = decode<C2S>(data.toString());
    if (!msg) return;
    if (!s.greeted && msg.t !== 'hello') return;
    handle(s, msg);
  });

  ws.on('close', () => {
    world.leave(s.id);
    sessions.delete(s.id);
    console.log(`[net] - ${s.id} (${sessions.size} online)`);
  });
});

// World tick loop (combat/AI systems will be added in M3).
let tick = 0;
const tickInterval = setInterval(() => {
  tick++;
}, 1000 / TICK_RATE);

const saveInterval = setInterval(() => {
  const count = world.flushDirtySaves();
  if (count > 0) console.log(`[save] flushed ${count} character(s)`);
}, 5000);

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  clearInterval(tickInterval);
  clearInterval(saveInterval);
  world.flushDirtySaves();
  store.close();
  wss.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

http.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}${WS_PATH} @ ${TICK_RATE}Hz`);
});

export { tick };
