import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MANIFEST,
  DIR_DELTA,
  Dir,
  canStep,
  cellDistance,
  getHeadStylesForBase,
  isCellWalkable,
  type CharacterSummary,
  type MapDef,
  type PlayerSummary,
  type S2C,
} from '@2dpw/shared';
import type { Store } from '../db/Store.ts';

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
  char?: CharacterSummary;
  dirty?: boolean;
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
    charId: p.char?.id,
    name: p.name,
    presetId: p.presetId,
    headStyle: p.char?.headStyle,
    hairColor: p.char?.hairColor,
    level: p.char?.level,
    exp: p.char?.exp,
    hp: p.char?.hp,
    maxHp: p.char?.maxHp,
    mp: p.char?.mp,
    maxMp: p.char?.maxMp,
    gold: p.char?.gold,
    bag: p.char?.bag,
    mapId: p.mapId,
    x: p.x,
    y: p.y,
    dir: p.dir,
  };
}

/**
 * Authoritative multiplayer world manager handling map collision,
 * Mir-style step rate-limiting, Chebyshev AOI visibility, portals,
 * and SQLite character persistence.
 */
export class World {
  private readonly players = new Map<string, PlayerState>();

  constructor(
    private readonly maps: Map<string, MapDef> = loadGeneratedMaps(),
    private readonly store?: Store,
  ) {}

  /** Number of currently joined players. */
  get size(): number {
    return this.players.size;
  }

  /** Return the default starting map and walkable spawn cell. */
  getDefaultSpawn(): { mapId: string; x: number; y: number } {
    const fallbackMapId = this.maps.has('arrival')
      ? 'arrival'
      : (this.maps.keys().next().value ?? '');
    const map = this.maps.get(fallbackMapId);
    return map
      ? { mapId: map.id, x: map.spawn.x, y: map.spawn.y }
      : { mapId: 'arrival', x: 20, y: 20 };
  }

  /** Place a guest connected session into a map and sync initial AOI peers. */
  join(
    playerId: string,
    opts: { name?: string; presetId?: string; mapId?: string },
    send: (msg: S2C) => void,
  ): PlayerState | null {
    const defSpawn = this.getDefaultSpawn();
    const mapId = opts.mapId && this.maps.has(opts.mapId) ? opts.mapId : defSpawn.mapId;
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
    return this.enterWorldState(player);
  }

  /** Place a persistent character into its saved map and coordinates. */
  joinCharacter(
    playerId: string,
    char: CharacterSummary,
    send: (msg: S2C) => void,
  ): PlayerState | null {
    for (const other of [...this.players.values()]) {
      if (other.char?.id === char.id && other.id !== playerId) {
        this.leave(other.id);
      }
    }
    if (this.players.has(playerId)) {
      this.leave(playerId);
    }

    const defSpawn = this.getDefaultSpawn();
    const mapId = this.maps.has(char.mapId) ? char.mapId : defSpawn.mapId;
    const map = this.maps.get(mapId);
    if (!map) return null;

    const walkable = isCellWalkable(map.collision, char.x, char.y);
    const x = walkable ? char.x : map.spawn.x;
    const y = walkable ? char.y : map.spawn.y;
    const dir = char.dir in DIR_DELTA ? char.dir : Dir.S;
    const presetId = char.presetId in DEFAULT_MANIFEST.classes ? char.presetId : 'blademaster.male';

    const clonedChar: CharacterSummary = {
      ...char,
      presetId,
      mapId,
      x,
      y,
      dir,
      bag: char.bag.map((item) => ({ ...item })),
    };

    const player: PlayerState = {
      id: playerId,
      name: clonedChar.name,
      presetId,
      mapId,
      x,
      y,
      dir,
      lastStepAt: 0,
      send,
      char: clonedChar,
      dirty: false,
    };
    return this.enterWorldState(player);
  }

  private enterWorldState(player: PlayerState): PlayerState {
    this.players.set(player.id, player);
    const peers = this.getAoiPeers(player);
    for (const peer of peers) {
      peer.send({ t: 'peerEnter', peer: toSummary(player) });
    }
    player.send({ t: 'joined', self: toSummary(player), peers: peers.map(toSummary) });
    return player;
  }

  /** Save if dirty, remove a player, and notify any visible peers. */
  leave(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;

    this.savePlayer(p);
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
    if (p.char) {
      p.char.x = p.x;
      p.char.y = p.y;
      p.char.dir = p.dir;
      p.dirty = true;
    }

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
    const preset = DEFAULT_MANIFEST.classes[presetId];
    if (!p || !preset) return;
    p.presetId = presetId;
    if (p.char) {
      p.char.presetId = presetId;
      const validHeads = getHeadStylesForBase(preset.base);
      if (!validHeads.some((h) => h.id === p.char!.headStyle)) {
        p.char.headStyle = preset.layers.head ?? validHeads[0]?.id ?? 'leather_hood';
      }
      this.savePlayer(p);
    }
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

  /** Consume one item from the player's bag, update stats/level, and save immediately. */
  useBagItem(playerId: string, slot: number): void {
    const p = this.players.get(playerId);
    if (!p?.char) return;

    const idx = p.char.bag.findIndex((item) => item.slot === slot);
    if (idx < 0) return;
    const item = p.char.bag[idx]!;

    switch (item.itemId) {
      case 'potion_hp_s':
        p.char.hp = Math.min(p.char.maxHp, p.char.hp + 50);
        break;
      case 'potion_mp_s':
        p.char.mp = Math.min(p.char.maxMp, p.char.mp + 50);
        break;
      case 'scroll_exp':
        p.char.level += 1;
        p.char.exp += 100;
        p.char.maxHp += 25;
        p.char.maxMp += 15;
        p.char.hp = p.char.maxHp;
        p.char.mp = p.char.maxMp;
        break;
      case 'coin_pouch':
        p.char.gold += 200;
        break;
      default:
        return;
    }

    item.count -= 1;
    if (item.count <= 0) {
      p.char.bag.splice(idx, 1);
    }

    this.savePlayer(p);
    p.send({
      t: 'charStats',
      level: p.char.level,
      exp: p.char.exp,
      hp: p.char.hp,
      maxHp: p.char.maxHp,
      mp: p.char.mp,
      maxMp: p.char.maxMp,
      gold: p.char.gold,
      bag: p.char.bag,
    });
  }

  /** Flush all dirty online character snapshots to SQLite. */
  flushDirtySaves(): number {
    let saved = 0;
    for (const p of this.players.values()) {
      if (p.char && p.dirty) {
        this.savePlayer(p);
        saved++;
      }
    }
    return saved;
  }

  private savePlayer(p: PlayerState): void {
    if (!p.char || !this.store) return;
    p.char.mapId = p.mapId;
    p.char.x = p.x;
    p.char.y = p.y;
    p.char.dir = p.dir;
    p.char.presetId = p.presetId;
    this.store.saveCharacterState(p.char);
    p.dirty = false;
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
    if (p.char) {
      p.char.mapId = p.mapId;
      p.char.x = p.x;
      p.char.y = p.y;
      p.char.dir = p.dir;
      this.savePlayer(p);
    }

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
