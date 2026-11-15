import { describe, expect, it } from 'vitest';
import { Dir, DIR_DELTA, cellDistance, cellToScreen, dirTo, screenToCell, step } from './grid.ts';
import { CLASSES, isValidClassGender } from './races.ts';

describe('grid', () => {
  it('screen <-> cell round trips', () => {
    for (let x = -5; x <= 5; x++)
      for (let y = -5; y <= 5; y++) {
        const s = cellToScreen(x, y);
        expect(screenToCell(s.x, s.y)).toEqual({ x, y });
      }
  });

  it('dirTo matches DIR_DELTA for every neighbour', () => {
    const o = { x: 10, y: 10 };
    for (const d of Object.keys(DIR_DELTA).map(Number) as Dir[]) {
      expect(dirTo(o, step(o, d))).toBe(d);
    }
  });

  it('north is straight up on screen', () => {
    const s = cellToScreen(DIR_DELTA[Dir.N].x, DIR_DELTA[Dir.N].y);
    expect(s.x).toBe(0);
    expect(s.y).toBeLessThan(0);
  });

  it('chebyshev distance', () => {
    expect(cellDistance({ x: 0, y: 0 }, { x: 3, y: -2 })).toBe(3);
  });
});

describe('races', () => {
  it('has exactly 6 classes across 3 races', () => {
    const list = Object.values(CLASSES);
    expect(list).toHaveLength(6);
    expect(new Set(list.map((c) => c.race)).size).toBe(3);
  });

  it('enforces gender locks', () => {
    expect(isValidClassGender('barbarian', 'female')).toBe(false);
    expect(isValidClassGender('venomancer', 'male')).toBe(false);
    expect(isValidClassGender('archer', 'female')).toBe(true);
  });
});
