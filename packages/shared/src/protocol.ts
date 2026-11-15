import type { Dir } from './grid.ts';
import type { ClassId, Gender, Race } from './races.ts';

export interface InventoryItem {
  slot: number;
  itemId: string;
  name: string;
  count: number;
  desc?: string;
}

export interface CharacterSummary {
  id: string;
  name: string;
  race: Race;
  classId: ClassId;
  gender: Gender;
  presetId: string;
  headStyle: string;
  hairColor: string;
  level: number;
  exp: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  gold: number;
  mapId: string;
  x: number;
  y: number;
  dir: Dir;
  bag: InventoryItem[];
}

export interface PlayerSummary {
  id: string;
  charId?: string;
  name: string;
  presetId: string;
  headStyle?: string;
  hairColor?: string;
  level?: number;
  exp?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  gold?: number;
  bag?: InventoryItem[];
  mapId: string;
  x: number;
  y: number;
  dir: Dir;
}

/**
 * Wire protocol. JSON for now (debuggable); every message has a `t` tag.
 * C2S = client -> server, S2C = server -> client.
 */
export type C2S =
  | { t: 'hello'; version: number }
  | { t: 'ping'; at: number }
  | { t: 'register'; username: string; password: string }
  | { t: 'login'; username: string; password: string }
  | { t: 'resume'; token: string }
  | { t: 'logout' }
  | {
      t: 'createCharacter';
      name: string;
      classId: ClassId;
      gender: Gender;
      headStyle?: string;
      hairColor?: string;
    }
  | { t: 'deleteCharacter'; charId: string }
  | { t: 'enterWorld'; charId: string }
  | { t: 'useBagItem'; slot: number }
  | { t: 'join'; name?: string; presetId?: string; mapId?: string }
  | { t: 'move'; seq: number; dir: Dir; steps: 1 | 2 }
  | { t: 'setPreset'; presetId: string }
  | { t: 'teleport'; mapId: string };

export type S2C =
  | { t: 'welcome'; version: number; sessionId: string; serverTime: number }
  | { t: 'pong'; at: number; serverTime: number }
  | { t: 'error'; code: string; message: string }
  | { t: 'authOk'; username: string; token: string; characters: CharacterSummary[] }
  | { t: 'authError'; message: string }
  | { t: 'characterList'; characters: CharacterSummary[] }
  | {
      t: 'charStats';
      level: number;
      exp: number;
      hp: number;
      maxHp: number;
      mp: number;
      maxMp: number;
      gold: number;
      bag: InventoryItem[];
    }
  | { t: 'joined'; self: PlayerSummary; peers: PlayerSummary[] }
  | { t: 'peerEnter'; peer: PlayerSummary }
  | { t: 'peerLeave'; id: string }
  | { t: 'peerPreset'; id: string; presetId: string }
  | { t: 'entityMoved'; id: string; x: number; y: number; dir: Dir; steps: 1 | 2; seq?: number }
  | { t: 'correct'; seq: number; x: number; y: number; dir: Dir; reason: string };

export function encode(msg: C2S | S2C): string {
  return JSON.stringify(msg);
}

export function decode<T extends C2S | S2C>(raw: string): T | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && typeof (v as { t?: unknown }).t === 'string') return v as T;
    return null;
  } catch {
    return null;
  }
}
