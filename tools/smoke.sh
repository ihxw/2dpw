#!/usr/bin/env bash
# M0/M1 smoke test: boot server + vite, verify assets, WS handshake, AOI join, move, and correction.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsx packages/server/src/main.ts > /tmp/2dpw-server.log 2>&1 &
SP=$!
(cd packages/client && npx vite --port 5173 --strictPort > /tmp/2dpw-vite.log 2>&1) &
VP=$!
trap 'kill $SP $VP 2>/dev/null || true; pkill -f "vite --port 5173" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -sf localhost:5173/ >/dev/null && curl -sf localhost:7788/health >/dev/null && break; sleep 0.5; done

echo "health: $(curl -s localhost:7788/health)"
echo "index.html: $(curl -s -o /dev/null -w '%{http_code}' localhost:5173/)"
echo "main.ts:    $(curl -s -o /dev/null -w '%{http_code}' localhost:5173/src/main.ts)"
for asset in \
  /assets/generated/manifest.json \
  /assets/generated/maps/arrival.json \
  /assets/vendor/flare-game/mods/fantasycore/images/tilesets/tileset_grassland.png; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "localhost:5173${asset}")
  echo "${asset}: ${code}"
  if [ "$code" != "200" ]; then
    echo "ERROR: expected 200 for ${asset}, got ${code}"
    exit 1
  fi
done

npx tsx -e '
import fs from "node:fs";
import { WebSocket } from "ws";
import { canStep, type Dir, type MapDef, type S2C } from "./packages/shared/src/index.ts";

const map = JSON.parse(fs.readFileSync("assets/generated/maps/arrival.json", "utf8")) as MapDef;

function connectClient(label: string) {
  return new Promise<{
    ws: WebSocket;
    sessionId: string;
    inbox: S2C[];
    nextMsg: (pred: (m: S2C) => boolean, ms?: number) => Promise<S2C>;
  }>((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:5173/ws");
    const inbox: S2C[] = [];
    const waiters: Array<{ pred: (m: S2C) => boolean; res: (m: S2C) => void; rej: (e: Error) => void; timer: NodeJS.Timeout }> = [];
    const timer = setTimeout(() => reject(new Error(`${label}: connect timeout`)), 5000);

    function nextMsg(pred: (m: S2C) => boolean, ms = 4000): Promise<S2C> {
      const idx = inbox.findIndex(pred);
      if (idx >= 0) return Promise.resolve(inbox.splice(idx, 1)[0]);
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error(`${label}: wait timeout`)), ms);
        waiters.push({ pred, res, rej, timer: t });
      });
    }

    ws.on("error", (e) => reject(new Error(`${label}: ws error ${e.message}`)));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as S2C;
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].pred(msg)) {
          const [w] = waiters.splice(i, 1);
          clearTimeout(w.timer);
          w.res(msg);
          return;
        }
      }
      inbox.push(msg);
    });
    ws.on("open", () => {
      ws.send(JSON.stringify({ t: "hello", version: 1 }));
      nextMsg((m) => m.t === "welcome")
        .then((w) => {
          clearTimeout(timer);
          if (w.t !== "welcome") throw new Error("unexpected");
          resolve({ ws, sessionId: w.sessionId, inbox, nextMsg });
        })
        .catch(reject);
    });
  });
}

async function main() {
  const a = await connectClient("A");
  a.ws.send(JSON.stringify({ t: "ping", at: 1 }));
  await a.nextMsg((m) => m.t === "pong");
  console.log("ws ping/pong ok:", a.sessionId);

  a.ws.send(JSON.stringify({ t: "join", name: "SmokeA", presetId: "blademaster.male", mapId: "arrival" }));
  const joinedA = await a.nextMsg((m) => m.t === "joined");
  if (joinedA.t !== "joined") throw new Error("A did not join");

  const b = await connectClient("B");
  b.ws.send(JSON.stringify({ t: "join", name: "SmokeB", presetId: "cleric.female", mapId: "arrival" }));
  const [joinedB, peerEnterA] = await Promise.all([
    b.nextMsg((m) => m.t === "joined"),
    a.nextMsg((m) => m.t === "peerEnter"),
  ]);
  if (joinedB.t !== "joined" || !joinedB.peers.some((p) => p.id === a.sessionId)) {
    throw new Error("B joined peers missing A");
  }
  if (peerEnterA.t !== "peerEnter" || peerEnterA.peer.id !== b.sessionId) {
    throw new Error("A missing peerEnter for B");
  }
  console.log("ws AOI join ok:", a.sessionId, "<->", b.sessionId);

  let walkDir: Dir | null = null;
  let afterWalk = { x: joinedA.self.x, y: joinedA.self.y };
  for (let d = 0; d < 8; d++) {
    const c = canStep(map.collision, afterWalk, d as Dir, 1);
    if (c.ok) {
      walkDir = d as Dir;
      afterWalk = c.to;
      break;
    }
  }
  if (walkDir === null) throw new Error("No walkable step from spawn");

  a.ws.send(JSON.stringify({ t: "move", seq: 1, dir: walkDir, steps: 1 }));
  const [movedA, movedB] = await Promise.all([
    a.nextMsg((m) => m.t === "entityMoved" && m.id === a.sessionId),
    b.nextMsg((m) => m.t === "entityMoved" && m.id === a.sessionId),
  ]);
  if (
    movedA.t !== "entityMoved" ||
    movedA.seq !== 1 ||
    movedA.x !== afterWalk.x ||
    movedA.y !== afterWalk.y
  ) {
    throw new Error("A entityMoved mismatch");
  }
  if (movedB.t !== "entityMoved" || movedB.x !== afterWalk.x || movedB.y !== afterWalk.y) {
    throw new Error("B entityMoved mismatch");
  }
  console.log("ws move broadcast ok ->", afterWalk.x, afterWalk.y);

  await new Promise((r) => setTimeout(r, 460));

  let badDir: number = 99;
  let badSteps: 1 | 2 = 1;
  outer: for (const st of [1, 2] as const) {
    for (let d = 0; d < 8; d++) {
      if (!canStep(map.collision, afterWalk, d as Dir, st).ok) {
        badDir = d;
        badSteps = st;
        break outer;
      }
    }
  }

  a.ws.send(JSON.stringify({ t: "move", seq: 2, dir: badDir, steps: badSteps }));
  const corr = await a.nextMsg((m) => m.t === "correct");
  if (corr.t !== "correct" || corr.seq !== 2 || corr.x !== afterWalk.x || corr.y !== afterWalk.y) {
    throw new Error("Expected authoritative correct");
  }
  console.log("ws correction ok:", corr.reason);

  a.ws.close();
  b.ws.close();
  console.log("SMOKE OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
'
