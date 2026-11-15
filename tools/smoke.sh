#!/usr/bin/env bash
# M0 smoke test: boot server + vite, connect a WS client through the Vite proxy.
set -u
cd "$(dirname "$0")/.."
npx tsx packages/server/src/main.ts > /tmp/2dpw-server.log 2>&1 &
SP=$!
(cd packages/client && npx vite --port 5173 --strictPort > /tmp/2dpw-vite.log 2>&1) &
VP=$!
trap 'kill $SP $VP 2>/dev/null; pkill -f "vite --port 5173" 2>/dev/null' EXIT
for _ in $(seq 1 30); do curl -sf localhost:5173/ >/dev/null && curl -sf localhost:7788/health >/dev/null && break; sleep 0.5; done

echo "health: $(curl -s localhost:7788/health)"
echo "index.html: $(curl -s -o /dev/null -w '%{http_code}' localhost:5173/)"
echo "main.ts:    $(curl -s -o /dev/null -w '%{http_code}' localhost:5173/src/main.ts)"
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:5173/ws');
const t = setTimeout(() => { console.error('timeout'); process.exit(1); }, 5000);
ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', version: 1 })));
ws.on('message', (m) => {
  const v = JSON.parse(m);
  console.log('ws recv:', v.t, v.sessionId ?? '');
  if (v.t === 'welcome') ws.send(JSON.stringify({ t: 'ping', at: 1 }));
  else { clearTimeout(t); ws.close(); console.log('SMOKE OK'); }
});
ws.on('error', (e) => { console.error('ws error', e.message); process.exit(1); });
"
