import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
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

const port = Number(process.env.PORT ?? SERVER_PORT);

interface Session {
  id: string;
  ws: WebSocket;
  greeted: boolean;
}

const sessions = new Map<string, Session>();

function send(s: Session, msg: S2C): void {
  if (s.ws.readyState === s.ws.OPEN) s.ws.send(encode(msg));
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
  }
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
    return;
  }
  res.writeHead(404).end();
});

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
    sessions.delete(s.id);
    console.log(`[net] - ${s.id} (${sessions.size} online)`);
  });
});

// World tick loop (empty for now; systems are added in M1+).
let tick = 0;
setInterval(() => {
  tick++;
}, 1000 / TICK_RATE);

http.listen(port, () => {
  console.log(`[server] listening on :${port}${WS_PATH} @ ${TICK_RATE}Hz`);
});

export { tick };
