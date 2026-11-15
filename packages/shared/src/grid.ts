import { TILE_H, TILE_W } from './constants.ts';

/**
 * 8 directions, numbered to match Flare's sprite direction order
 * (0 = west, then clockwise: NW, N, NE, E, SE, S, SW) in screen space.
 * Grid deltas are in map (cell) space for an isometric map where
 * +x goes screen down-right and +y goes screen down-left.
 */
export enum Dir {
  W = 0,
  NW = 1,
  N = 2,
  NE = 3,
  E = 4,
  SE = 5,
  S = 6,
  SW = 7,
}

export interface Cell {
  x: number;
  y: number;
}

/** Map-space delta for each screen direction. */
export const DIR_DELTA: Readonly<Record<Dir, Cell>> = {
  [Dir.W]: { x: -1, y: 1 },
  [Dir.NW]: { x: -1, y: 0 },
  [Dir.N]: { x: -1, y: -1 },
  [Dir.NE]: { x: 0, y: -1 },
  [Dir.E]: { x: 1, y: -1 },
  [Dir.SE]: { x: 1, y: 0 },
  [Dir.S]: { x: 1, y: 1 },
  [Dir.SW]: { x: 0, y: 1 },
};

export function step(c: Cell, d: Dir, n = 1): Cell {
  const dd = DIR_DELTA[d];
  return { x: c.x + dd.x * n, y: c.y + dd.y * n };
}

/** Direction from a to b (only exact for neighbours; otherwise the closest octant). */
export function dirTo(a: Cell, b: Cell): Dir {
  const s = cellToScreen(b.x - a.x, b.y - a.y);
  const angle = Math.atan2(s.y, s.x); // screen space, y down
  // octant 0 = east, counting clockwise because screen y is down
  const oct = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
  const fromEast: Dir[] = [Dir.E, Dir.SE, Dir.S, Dir.SW, Dir.W, Dir.NW, Dir.N, Dir.NE];
  return fromEast[oct]!;
}

/** Chebyshev distance — the "grid range" used for attack/skill ranges. */
export function cellDistance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Isometric projection: cell centre -> screen pixels (origin = cell 0,0 centre). */
export function cellToScreen(x: number, y: number): { x: number; y: number } {
  return { x: ((x - y) * TILE_W) / 2, y: ((x + y) * TILE_H) / 2 };
}

/** Inverse projection: screen pixels -> nearest cell. */
export function screenToCell(sx: number, sy: number): Cell {
  const fx = sx / TILE_W + sy / TILE_H;
  const fy = sy / TILE_H - sx / TILE_W;
  return { x: Math.round(fx), y: Math.round(fy) };
}
