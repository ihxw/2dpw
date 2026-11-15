import type { Dir } from './grid.ts';

export interface PlayerSummary {
  id: string;
  name: string;
  presetId: string;
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
  | { t: 'join'; name?: string; presetId?: string; mapId?: string }
  | { t: 'move'; seq: number; dir: Dir; steps: 1 | 2 }
  | { t: 'setPreset'; presetId: string }
  | { t: 'teleport'; mapId: string };

export type S2C =
  | { t: 'welcome'; version: number; sessionId: string; serverTime: number }
  | { t: 'pong'; at: number; serverTime: number }
  | { t: 'error'; code: string; message: string }
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
