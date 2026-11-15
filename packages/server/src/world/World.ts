import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MANIFEST,
  DIR_DELTA,
  Dir,
  canStep,
  cellDistance,
  isCellWalkable,
  type MapDef,
  type PlayerSummary,
  type S2C,
} from '@2dpw/shared';

/** Maximum Chebyshev distance (in cells) for two players on the same map to see each other. */
export const AOI_RADIUS_CELLS = 24;

/** Minimum allowed interval (ms) between consecutive accepted steps. */
export const MIN_STEP_INTERVAL_MS = 420;

export interface PlayerState {
  id: string;
  name: string;
  presetId: string;
  mapId: string;
  x: number;
  y: number;
  dir: Dir;
  lastStepAt: number;
  send: (msg: S2C) => void;
}

/** Load all converted map JSON files listed in {@link DEFAULT_MANIFEST.maps}. */
export function loadGeneratedMaps(
  repoRoot = path.resolve(import.meta.dirname, '../../../..'),
): Map<string, MapDef> {
  const maps = new Map<string, MapDef>();
  for (const [id, entry] of Object.entries(DEFAULT_MANIFEST.maps)) {
    const filePath = path.join(repoRoot, 'assets/generated/maps', `${entry.file}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MapDef;
    maps.set(id, data);
  }
  return maps;
}

function toSummary(p: PlayerState): PlayerSummary {
  return {
    id: p.id,
    name: p.name,
    presetId: p.presetId,
    mapId: p.mapId,
    x: p.x,
    y: p.y,
    dir: p.dir,
  };
}

/**
 * Authoritative multiplayer world manager handling map collision,
 * Mir-style step rate-limiting, Chebyshev AOI visibility, and portals.
 */
export class World {
  private readonly players = new Map<string, PlayerState>();

  constructor(private readonly maps: Map<string, MapDef> = loadGeneratedMaps()) {}

  /** Number of currently joined players. */
  get size(): number {
    return this.players.size;
  }

  /** Place a connected session into a map and sync initial AOI peers. */
  join(
    playerId: string,
    opts: { name?: string; presetId?: string; mapId?: string },
    send: (msg: S2C) => void,
  ): PlayerState | null {
    const fallbackMapId = this.maps.has('arrival')
      ? 'arrival'
      : (this.maps.keys().next().value ?? '');
    const mapId = opts.mapId && this.maps.has(opts.mapId) ? opts.mapId : fallbackMapId;
    const map = this.maps.get(mapId);
    if (!map) return null;

    const presetId =
      opts.presetId && opts.presetId in DEFAULT_MANIFEST.classes
        ? opts.presetId
        : 'blademaster.male';
    const name = opts.name?.trim() || `侠士-${playerId.slice(0, 4)}`;

    if (this.players.has(playerId)) {
      this.leave(playerId);
    }

    const player: PlayerState = {
      id: playerId,
      name,
      presetId,
      mapId,
      x: map.spawn.x,
      y: map.spawn.y,
      dir: Dir.S,
      lastStepAt: 0,
      send,
    };
    this.players.set(playerId, player);

    const peers = this.getAoiPeers(player);
    for (const peer of peers) {
      peer.send({ t: 'peerEnter', peer: toSummary(player) });
    }
    player.send({ t: 'joined', self: toSummary(player), peers: peers.map(toSummary) });
    return player;
  }

  /** Remove a player and notify any visible peers. */
  leave(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;

    const peers = this.getAoiPeers(p);
    this.players.delete(playerId);
    for (const peer of peers) {
      peer.send({ t: 'peerLeave', id: p.id });
    }
  }

  /** Validate and apply a 1-cell walk or 2-cell run step, updating AOI and triggering portals. */
  move(playerId: string, msg: { seq: number; dir: Dir; steps: 1 | 2 }, now = Date.now()): void {
    const p = this.players.get(playerId);
    if (!p) return;
    const map = this.maps.get(p.mapId);
    if (!map) return;

    if (
      !(msg.dir in DIR_DELTA) ||
      (msg.steps !== 1 && msg.steps !== 2) ||
      !Number.isFinite(msg.seq)
    ) {
      p.send({ t: 'correct', seq: msg.seq, x: p.x, y: p.y, dir: p.dir, reason: 'invalid_input' });
      return;
    }

    if (now - p.lastStepAt < MIN_STEP_INTERVAL_MS) {
      p.send({ t: 'correct', seq: msg.seq, x: p.x, y: p.y, dir: p.dir, reason: 'rate_limit' });
      return;
    }

    const check = canStep(map.collision, p, msg.dir, msg.steps);
    if (!check.ok) {
      p.send({ t: 'correct', seq: msg.seq, x: p.x, y: p.y, dir: p.dir, reason: 'blocked' });
      return;
    }

    const oldPeerIds = new Set(this.getAoiPeers(p).map((o) => o.id));
    p.x = check.to.x;
    p.y = check.to.y;
    p.dir = msg.dir;
    p.lastStepAt = now;

    const newPeers = this.getAoiPeers(p);
    const newPeerIds = new Set(newPeers.map((o) => o.id));

    for (const peer of newPeers) {
      if (!oldPeerIds.has(peer.id)) {
        peer.send({ t: 'peerEnter', peer: toSummary(p) });
        p.send({ t: 'peerEnter', peer: toSummary(peer) });
      }
    }

    for (const oldId of oldPeerIds) {
      if (!newPeerIds.has(oldId)) {
        const oldPeer = this.players.get(oldId);
        oldPeer?.send({ t: 'peerLeave', id: p.id });
        p.send({ t: 'peerLeave', id: oldId });
      }
    }

    p.send({
      t: 'entityMoved',
      id: p.id,
      x: p.x,
      y: p.y,
      dir: p.dir,
      steps: msg.steps,
      seq: msg.seq,
    });
    for (const peer of newPeers) {
      peer.send({
        t: 'entityMoved',
        id: p.id,
        x: p.x,
        y: p.y,
        dir: p.dir,
        steps: msg.steps,
      });
    }

    const portal = map.portals.find(
      (pt) => p.x >= pt.x && p.x < pt.x + pt.w && p.y >= pt.y && p.y < pt.y + pt.h,
    );
    if (portal && this.maps.has(portal.targetMap)) {
      this.transferMap(p, portal.targetMap, portal.targetX, portal.targetY);
    }
  }

  /** Update a player's class preset and notify AOI peers. */
  setPreset(playerId: string, presetId: string): void {
    const p = this.players.get(playerId);
    if (!p || !(presetId in DEFAULT_MANIFEST.classes)) return;
    p.presetId = presetId;
    p.send({ t: 'peerPreset', id: p.id, presetId });
    for (const peer of this.getAoiPeers(p)) {
      peer.send({ t: 'peerPreset', id: p.id, presetId });
    }
  }

  /** Teleport a player directly to another map's spawn point. */
  teleport(playerId: string, mapId: string): void {
    const p = this.players.get(playerId);
    const target = this.maps.get(mapId);
    if (!p || !target) return;
    this.transferMap(p, target.id, target.spawn.x, target.spawn.y);
  }

  private transferMap(p: PlayerState, targetMapId: string, targetX: number, targetY: number): void {
    const targetMap = this.maps.get(targetMapId);
    if (!targetMap) return;

    const oldPeers = this.getAoiPeers(p);
    for (const peer of oldPeers) {
      peer.send({ t: 'peerLeave', id: p.id });
    }

    const validDest = isCellWalkable(targetMap.collision, targetX, targetY);
    p.mapId = targetMap.id;
    p.x = validDest ? targetX : targetMap.spawn.x;
    p.y = validDest ? targetY : targetMap.spawn.y;
    p.lastStepAt = 0;

    const newPeers = this.getAoiPeers(p);
    for (const peer of newPeers) {
      peer.send({ t: 'peerEnter', peer: toSummary(p) });
    }
    p.send({ t: 'joined', self: toSummary(p), peers: newPeers.map(toSummary) });
  }

  private getAoiPeers(p: PlayerState): PlayerState[] {
    const out: PlayerState[] = [];
    for (const other of this.players.values()) {
      if (other.id === p.id || other.mapId !== p.mapId) continue;
      if (cellDistance(p, other) <= AOI_RADIUS_CELLS) out.push(other);
    }
    return out;
  }
}
