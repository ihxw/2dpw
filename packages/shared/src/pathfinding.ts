import { DIR_DELTA, Dir, cellDistance, dirTo, step, type Cell } from './grid.ts';

const ALL_DIRS: readonly Dir[] = [Dir.W, Dir.NW, Dir.N, Dir.NE, Dir.E, Dir.SE, Dir.S, Dir.SW];

export interface MoveStep {
  dir: Dir;
  steps: 1 | 2;
  to: Cell;
}

/** Return true iff `(x, y)` is inside the map bounds and walkable (`collision === 0`). */
export function isCellWalkable(collision: number[][], x: number, y: number): boolean {
  if (y < 0 || y >= collision.length) return false;
  const row = collision[y];
  if (!row || x < 0 || x >= row.length) return false;
  return row[x] === 0;
}

/**
 * Validate a Mir-style discrete 1-cell walk or 2-cell run step.
 * Both the intermediate cell and destination cell must be walkable.
 */
export function canStep(
  collision: number[][],
  from: Cell,
  dir: Dir,
  steps: 1 | 2,
): { ok: true; to: Cell } | { ok: false } {
  const c1 = step(from, dir, 1);
  if (!isCellWalkable(collision, c1.x, c1.y)) return { ok: false };
  if (steps === 1) return { ok: true, to: c1 };

  const c2 = step(from, dir, 2);
  if (!isCellWalkable(collision, c2.x, c2.y)) return { ok: false };
  return { ok: true, to: c2 };
}

class MinHeap<T> {
  private items: T[] = [];

  constructor(private readonly score: (item: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.score(this.items[i]!) >= this.score(this.items[parent]!)) break;
      const tmp = this.items[parent]!;
      this.items[parent] = this.items[i]!;
      this.items[i] = tmp;
      i = parent;
    }
  }

  pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      while (true) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < n && this.score(this.items[left]!) < this.score(this.items[smallest]!)) {
          smallest = left;
        }
        if (right < n && this.score(this.items[right]!) < this.score(this.items[smallest]!)) {
          smallest = right;
        }
        if (smallest === i) break;
        const tmp = this.items[i]!;
        this.items[i] = this.items[smallest]!;
        this.items[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

interface AStarNode {
  x: number;
  y: number;
  g: number;
  f: number;
}

function packKey(x: number, y: number): number {
  return (x + 32768) * 65536 + (y + 32768);
}

/**
 * Find an 8-direction path from `start` to `goal` using A*.
 * Returns the ordered array of cells excluding `start`, or `[]` if unreachable.
 */
export function findPath(collision: number[][], start: Cell, goal: Cell, maxNodes = 2500): Cell[] {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (!isCellWalkable(collision, goal.x, goal.y)) return [];

  const startKey = packKey(start.x, start.y);
  const goalKey = packKey(goal.x, goal.y);

  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap<AStarNode>((n) => n.f);

  open.push({ x: start.x, y: start.y, g: 0, f: cellDistance(start, goal) });

  let expanded = 0;
  while (open.size > 0 && expanded < maxNodes) {
    const cur = open.pop()!;
    const curKey = packKey(cur.x, cur.y);
    if (curKey === goalKey) {
      const path: Cell[] = [];
      let k = goalKey;
      while (k !== startKey) {
        const y = (k % 65536) - 32768;
        const x = Math.floor(k / 65536) - 32768;
        path.push({ x, y });
        const prev = cameFrom.get(k);
        if (prev === undefined) break;
        k = prev;
      }
      path.reverse();
      return path;
    }

    if (closed.has(curKey)) continue;
    closed.add(curKey);
    expanded++;

    for (const d of ALL_DIRS) {
      const delta = DIR_DELTA[d];
      const nx = cur.x + delta.x;
      const ny = cur.y + delta.y;
      if (!isCellWalkable(collision, nx, ny)) continue;

      const nk = packKey(nx, ny);
      if (closed.has(nk)) continue;

      const ng = cur.g + 1;
      const prevG = gScore.get(nk);
      if (prevG !== undefined && ng >= prevG) continue;

      gScore.set(nk, ng);
      cameFrom.set(nk, curKey);
      const h = cellDistance({ x: nx, y: ny }, goal);
      const manhattanTie = (Math.abs(nx - goal.x) + Math.abs(ny - goal.y)) * 0.001;
      open.push({ x: nx, y: ny, g: ng, f: ng + h + manhattanTie });
    }
  }

  return [];
}

/**
 * Convert a contiguous cell path into discrete 1-cell walk or 2-cell run steps.
 */
export function pathToSteps(start: Cell, path: Cell[], allowRun: boolean): MoveStep[] {
  const out: MoveStep[] = [];
  let cur = start;
  let i = 0;

  while (i < path.length) {
    const c1 = path[i]!;
    const d1 = dirTo(cur, c1);
    if (allowRun && i + 1 < path.length) {
      const c2 = path[i + 1]!;
      const expected = step(cur, d1, 2);
      if (c2.x === expected.x && c2.y === expected.y) {
        out.push({ dir: d1, steps: 2, to: c2 });
        cur = c2;
        i += 2;
        continue;
      }
    }
    out.push({ dir: d1, steps: 1, to: c1 });
    cur = c1;
    i += 1;
  }

  return out;
}
