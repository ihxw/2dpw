import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Dir, type MapDef, type S2C } from '@2dpw/shared';
import { Store } from '../db/Store.ts';
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

describe('Store & persistence', () => {
  it('enforces gender locks and persists position, level, and bag across server restarts', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '2dpw-m2-'));
    const dbFile = path.join(tmpDir, 'test.sqlite');
    const maps = new Map([
      [
        'arrival',
        makeMap(
          'arrival',
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          { x: 1, y: 1 },
        ),
      ],
    ]);

    try {
      const store1 = new Store(dbFile);
      const reg = store1.register('player01', 'pass1234');
      expect(reg.ok).toBe(true);
      if (!reg.ok) return;

      expect(store1.login('player01', 'wrong')).toMatchObject({ ok: false });
      const login1 = store1.login('player01', 'pass1234');
      expect(login1.ok).toBe(true);
      expect(store1.verifyToken(reg.token)?.username).toBe('player01');

      // Gender restrictions: barbarian=male only, venomancer=female only
      const badBarb = store1.createCharacter(
        reg.accountId,
        { name: '女妖兽', classId: 'barbarian', gender: 'female' },
        { mapId: 'arrival', x: 1, y: 1 },
      );
      expect(badBarb.ok).toBe(false);

      const badVeno = store1.createCharacter(
        reg.accountId,
        { name: '男妖精', classId: 'venomancer', gender: 'male' },
        { mapId: 'arrival', x: 1, y: 1 },
      );
      expect(badVeno.ok).toBe(false);

      const created = store1.createCharacter(
        reg.accountId,
        {
          name: '赤狐仙',
          classId: 'venomancer',
          gender: 'female',
          headStyle: 'mage_hood_alt1',
          hairColor: 'crimson',
        },
        { mapId: 'arrival', x: 1, y: 1 },
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const world1 = new World(maps, store1);
      const inbox1: S2C[] = [];
      world1.joinCharacter('sess-1', created.character, (m) => inbox1.push(m));
      // Move Dir.SE (+1, 0) from (1,1) -> (2,1), then use scroll_exp (slot 2)
      world1.move('sess-1', { seq: 1, dir: Dir.SE, steps: 1 }, 1000);
      world1.useBagItem('sess-1', 2);

      const statsMsg = inbox1.find((m) => m.t === 'charStats');
      expect(statsMsg?.t === 'charStats' && statsMsg.level).toBe(2);

      world1.leave('sess-1');
      store1.close();

      // Reopen fresh Store & World instances to simulate full server restart
      const store2 = new Store(dbFile);
      const login2 = store2.login('player01', 'pass1234');
      expect(login2.ok).toBe(true);
      if (!login2.ok) return;

      const restored = login2.characters[0]!;
      expect(restored).toMatchObject({
        name: '赤狐仙',
        race: 'untamed',
        classId: 'venomancer',
        gender: 'female',
        headStyle: 'mage_hood_alt1',
        hairColor: 'crimson',
        level: 2,
        exp: 100,
        mapId: 'arrival',
        x: 2,
        y: 1,
      });
      const expScroll = restored.bag.find((it) => it.itemId === 'scroll_exp');
      expect(expScroll?.count).toBe(2);

      const world2 = new World(maps, store2);
      const inbox2: S2C[] = [];
      world2.joinCharacter('sess-2', restored, (m) => inbox2.push(m));
      const rejoined = inbox2.find((m) => m.t === 'joined');
      expect(rejoined?.t === 'joined' && rejoined.self).toMatchObject({
        x: 2,
        y: 1,
        level: 2,
        headStyle: 'mage_hood_alt1',
        hairColor: 'crimson',
      });
      store2.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
