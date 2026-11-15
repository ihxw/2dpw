/**
 * Wire protocol. JSON for now (debuggable); every message has a `t` tag.
 * C2S = client -> server, S2C = server -> client.
 */
export type C2S = { t: 'hello'; version: number } | { t: 'ping'; at: number };

export type S2C =
  | { t: 'welcome'; version: number; sessionId: string; serverTime: number }
  | { t: 'pong'; at: number; serverTime: number }
  | { t: 'error'; code: string; message: string };

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
