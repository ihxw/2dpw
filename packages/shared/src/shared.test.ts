import { describe, expect, it } from 'vitest';
import { DEFAULT_MANIFEST, HERO_LAYER_ORDER, stepAnimFrame, type AnimSection } from './assets.ts';
import { Dir, DIR_DELTA, cellDistance, cellToScreen, dirTo, screenToCell, step } from './grid.ts';
import { CLASSES, isValidClassGender } from './races.ts';
import {
  parseFlareAnimTxt,
  parseFlareMapTxt,
  parseFlareTilesetTxt,
} from '../../../tools/flare-convert/convert.ts';

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

describe('assets & manifest', () => {
  it('defines layer order for all 8 directions with all 7 equip slots', () => {
    for (const d of [Dir.W, Dir.NW, Dir.N, Dir.NE, Dir.E, Dir.SE, Dir.S, Dir.SW]) {
      const order = HERO_LAYER_ORDER[d];
      expect(order).toHaveLength(7);
      expect(new Set(order)).toEqual(
        new Set(['main', 'feet', 'legs', 'hands', 'chest', 'off', 'head']),
      );
    }
    expect(HERO_LAYER_ORDER[Dir.N].at(-1)).toBe('main');
    expect(HERO_LAYER_ORDER[Dir.S].at(0)).toBe('main');
  });

  it('manifest has all 10 valid class x gender presets, 12 monsters, 5 npcs, 10 powers, 4 maps', () => {
    const presets = Object.values(DEFAULT_MANIFEST.classes);
    expect(presets).toHaveLength(10);
    for (const p of presets) {
      expect(isValidClassGender(p.classId, p.gender)).toBe(true);
    }
    expect(Object.keys(DEFAULT_MANIFEST.monsters)).toHaveLength(12);
    expect(Object.keys(DEFAULT_MANIFEST.npcs)).toHaveLength(5);
    expect(Object.keys(DEFAULT_MANIFEST.powers)).toHaveLength(10);
    expect(Object.keys(DEFAULT_MANIFEST.maps)).toHaveLength(4);
  });

  it('stepAnimFrame handles looped, play_once, and back_forth', () => {
    const mk = (type: AnimSection['type'], frames = 4, durationMs = 400): AnimSection => ({
      name: 'test',
      frames,
      durationMs,
      type,
      list: [],
    });

    const looped = mk('looped');
    expect(stepAnimFrame(looped, 0)).toBe(0);
    expect(stepAnimFrame(looped, 150)).toBe(1);
    expect(stepAnimFrame(looped, 450)).toBe(0);

    const once = mk('play_once');
    expect(stepAnimFrame(once, 0)).toBe(0);
    expect(stepAnimFrame(once, 399)).toBe(3);
    expect(stepAnimFrame(once, 9999)).toBe(3);

    const bf = mk('back_forth', 4, 600);
    expect([0, 100, 200, 300, 400, 500].map((t) => stepAnimFrame(bf, t))).toEqual([
      0, 1, 2, 3, 2, 1,
    ]);
  });
});

describe('flare-convert parsers', () => {
  it('parses anim txt with INCLUDE, multi-sheet images, and 1x1 power placeholders', () => {
    const included = `
image=images/powers/heal.png
[power]
frames=2
duration=200ms
type=play_once
frame=0,0,10,20,100,80,50,70
frame=0,1,1,1,1,1,0,0
frame=0,7,1,1,1,1,0,0
frame=1,0,120,20,110,90,55,75
frame=1,3,1,1,1,1,0,0
`;
    const main = `
# comment
INCLUDE animations/powers/heal.txt
`;
    const res = parseFlareAnimTxt('powers/heal_copy', main, (rel) =>
      rel === 'animations/powers/heal.txt' ? included : '',
    );
    expect(res.images.default).toBe(
      '/assets/vendor/flare-game/mods/fantasycore/images/powers/heal.png',
    );
    const sec = res.anims.power!;
    expect(sec.frames).toBe(2);
    expect(sec.durationMs).toBe(200);
    expect(sec.type).toBe('play_once');
    const f0d7 = sec.list.find((f) => f.i === 0 && f.d === 7)!;
    expect(f0d7).toMatchObject({ x: 10, y: 20, w: 100, h: 80, ox: 50, oy: 70 });
    const f1d3 = sec.list.find((f) => f.i === 1 && f.d === 3)!;
    expect(f1d3).toMatchObject({ x: 120, y: 20, w: 110, h: 90, ox: 55, oy: 75 });

    const multi = `
image=images/enemies/minotaur/minotaur_stance.png,stance
image=images/enemies/minotaur/minotaur_die.png,die
[stance]
frames=1
duration=1s
type=looped
frame=0,0,0,10,50,60,25,55,stance
`;
    const mres = parseFlareAnimTxt('enemies/minotaur', multi);
    expect(mres.images.stance).toContain('minotaur_stance.png');
    expect(mres.images.die).toContain('minotaur_die.png');
    expect(mres.anims.stance!.durationMs).toBe(1000);
    expect(mres.anims.stance!.list[0]!.img).toBe('stance');
  });

  it('parses tilesetdef txt across multiple [tileset] sheets', () => {
    const txt = `
[tileset]
img=images/tilesets/tileset_grassland.png
tile=16,100,200,192,96,96,48

[tileset]
img=images/tilesets/tileset_grassland_water.png
tile=144,0,0,192,192,96,48
animation=144;0,0,250ms;
`;
    const ts = parseFlareTilesetTxt('tileset_grassland', txt);
    expect(ts.images.img0).toContain('tileset_grassland.png');
    expect(ts.images.img1).toContain('tileset_grassland_water.png');
    expect(ts.tiles[16]).toMatchObject({
      img: 'img0',
      x: 100,
      y: 200,
      w: 192,
      h: 96,
      ox: 96,
      oy: 48,
    });
    expect(ts.tiles[144]).toMatchObject({
      img: 'img1',
      x: 0,
      y: 0,
      w: 192,
      h: 192,
      ox: 96,
      oy: 48,
    });
  });

  it('parses map txt layers, portals, and spawns', () => {
    const mapTxt = `
[header]
width=2
height=2
tilewidth=192
tileheight=96
hero_pos=1,0
tileset=tilesetdefs/tileset_grassland.txt
title=Test Map

[layer]
type=background
data=
16,17,
18,19,

[layer]
type=object
data=
0,49,
0,0,

[layer]
type=collision
data=
0,1,
0,2,

[event]
type=event
location=1,1,1,1
intermap=maps/river_trail.txt,7,5
tooltip=River Trail

[npc]
type=npc
location=0,1,1,1
filename=npcs/tutorial.txt

[enemy]
type=enemy
location=1,0,1,1
category=zombie
level=3
`;
    const map = parseFlareMapTxt('test', mapTxt);
    expect(map.title).toBe('Test Map');
    expect(map.spawn).toEqual({ x: 1, y: 0 });
    expect(map.tileset).toBe('tileset_grassland');
    expect(map.groundLayers[0]!.data).toEqual([
      [16, 17],
      [18, 19],
    ]);
    expect(map.objectLayers[0]!.data).toEqual([
      [0, 49],
      [0, 0],
    ]);
    expect(map.collision).toEqual([
      [0, 1],
      [0, 2],
    ]);
    expect(map.portals).toEqual([
      {
        x: 1,
        y: 1,
        w: 1,
        h: 1,
        targetMap: 'river_trail',
        targetX: 7,
        targetY: 5,
        tooltip: 'River Trail',
      },
    ]);
    expect(map.spawns).toEqual([
      { kind: 'npc', id: 'tutorial', x: 0, y: 1 },
      { kind: 'enemy', id: 'zombie', x: 1, y: 0, level: 3 },
    ]);
  });
});
