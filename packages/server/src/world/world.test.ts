import { describe, expect, it } from 'vitest';
import { Dir, type MapDef, type S2C } from '@2dpw/shared';
import { World, loadGeneratedMaps } from './World.ts';

function makeMap(
  id: string,
  collision: number[][],
  spawn: { x: number; y: number },
  portals: MapDef['portals'] = [],
): MapDef {
  return {
    id,
    title: id,
    width: collision[0]?.length ?? 0,
    height: collision.length,
    tileWidth: 192,
    tileHeight: 96,
    spawn,
    tileset: 'tileset_grassland',
    groundLayers: [],
    objectLayers: [],
    collision,
    portals,
    spawns: [],
  };
}

describe('World', () => {
  it('syncs AOI peers, rejects blocked steps, and transfers across portals', () => {
    const mapA = makeMap(
      'a',
      [
        [0, 0, 1],
        [0, 0, 0],
        [0, 0, 0],
      ],
      { x: 1, y: 1 },
      [{ x: 2, y: 1, w: 1, h: 1, targetMap: 'b', targetX: 0, targetY: 0 }],
    );
    const mapB = makeMap(
      'b',
      [
        [0, 0],
        [0, 0],
      ],
      { x: 1, y: 1 },
    );

    const world = new World(
      new Map([
        ['a', mapA],
        ['b', mapB],
      ]),
    );
    const inboxA: S2C[] = [];
    const inboxB: S2C[] = [];

    world.join('p1', { name: 'One', mapId: 'a' }, (m) => inboxA.push(m));
    world.join('p2', { name: 'Two', mapId: 'a' }, (m) => inboxB.push(m));

    expect(inboxA.some((m) => m.t === 'peerEnter' && m.peer.id === 'p2')).toBe(true);
    const joinedB = inboxB.find((m) => m.t === 'joined');
    expect(joinedB?.t === 'joined' && joinedB.peers.map((p) => p.id)).toEqual(['p1']);

    // Rate limit rejects immediate back-to-back move after valid move
    inboxA.length = 0;
    inboxB.length = 0;
    // Dir.N = (-1, -1) -> (0, 0)
    world.move('p1', { seq: 1, dir: Dir.N, steps: 1 }, 1000);
    expect(inboxA[0]).toMatchObject({ t: 'entityMoved', id: 'p1', x: 0, y: 0, seq: 1 });
    expect(inboxB[0]).toMatchObject({ t: 'entityMoved', id: 'p1', x: 0, y: 0 });

    inboxA.length = 0;
    world.move('p1', { seq: 2, dir: Dir.SE, steps: 1 }, 1100);
    expect(inboxA[0]).toMatchObject({ t: 'correct', seq: 2, x: 0, y: 0, reason: 'rate_limit' });

    // Blocked cell at (2, 0): from (0, 0) run SE (+2, 0) -> (2, 0) is collision=1
    inboxA.length = 0;
    world.move('p1', { seq: 3, dir: Dir.SE, steps: 2 }, 2000);
    expect(inboxA[0]).toMatchObject({ t: 'correct', seq: 3, x: 0, y: 0, reason: 'blocked' });

    // Move back to (1,1) via Dir.S (+1,+1), then step SE (+1,0) onto portal at (2,1) -> map b (0,0)
    world.move('p1', { seq: 4, dir: Dir.S, steps: 1 }, 3000);
    inboxA.length = 0;
    inboxB.length = 0;
    world.move('p1', { seq: 5, dir: Dir.SE, steps: 1 }, 4000);

    expect(inboxB.some((m) => m.t === 'peerLeave' && m.id === 'p1')).toBe(true);
    const transferred = inboxA.find((m) => m.t === 'joined');
    expect(transferred?.t === 'joined' && transferred.self).toMatchObject({
      mapId: 'b',
      x: 0,
      y: 0,
    });
  });

  it('loads all 4 generated maps with walkable spawns', () => {
    const maps = loadGeneratedMaps();
    expect(maps.size).toBe(4);
    for (const m of maps.values()) {
      expect(m.collision[m.spawn.y]?.[m.spawn.x]).toBe(0);
    }
  });
});
