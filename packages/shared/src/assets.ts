import { Dir } from './grid.ts';
import type { ClassId, Gender } from './races.ts';

/** Equipment render slots in Flare's paper-doll model. */
export type EquipLayer = 'main' | 'feet' | 'legs' | 'hands' | 'chest' | 'off' | 'head';

/**
 * Per-direction layer draw order from back to front, matching
 * Flare's `engine/hero_layers.txt`.
 */
export const HERO_LAYER_ORDER: Readonly<Record<Dir, readonly EquipLayer[]>> = {
  [Dir.SW]: ['main', 'feet', 'legs', 'hands', 'chest', 'off', 'head'],
  [Dir.W]: ['main', 'feet', 'legs', 'hands', 'chest', 'off', 'head'],
  [Dir.NW]: ['main', 'feet', 'legs', 'hands', 'chest', 'off', 'head'],
  [Dir.N]: ['feet', 'legs', 'hands', 'chest', 'off', 'head', 'main'],
  [Dir.NE]: ['feet', 'legs', 'hands', 'chest', 'off', 'head', 'main'],
  [Dir.E]: ['feet', 'legs', 'hands', 'chest', 'off', 'head', 'main'],
  [Dir.SE]: ['feet', 'legs', 'hands', 'main', 'chest', 'head', 'off'],
  [Dir.S]: ['main', 'feet', 'legs', 'hands', 'chest', 'head', 'off'],
};

export type AvatarBase = 'male' | 'female' | 'female_dark';

export type AnimPlayType = 'looped' | 'play_once' | 'back_forth';

export interface AnimFrame {
  i: number;
  d: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  img?: string;
}

export interface AnimSection {
  name: string;
  frames: number;
  durationMs: number;
  type: AnimPlayType;
  list: AnimFrame[];
}

export interface AnimSetDef {
  id: string;
  images: Record<string, string>;
  anims: Record<string, AnimSection>;
}

export interface TileDef {
  id: number;
  img: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export interface TilesetDef {
  id: string;
  images: Record<string, string>;
  tiles: Record<number, TileDef>;
}

export interface MapPortal {
  x: number;
  y: number;
  w: number;
  h: number;
  targetMap: string;
  targetX: number;
  targetY: number;
  tooltip?: string;
}

export interface MapSpawn {
  kind: 'npc' | 'enemy';
  id: string;
  x: number;
  y: number;
  level?: number;
}

export interface MapLayer {
  name: string;
  data: number[][];
}

export interface MapDef {
  id: string;
  title: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  spawn: { x: number; y: number };
  tileset: string;
  groundLayers: MapLayer[];
  objectLayers: MapLayer[];
  collision: number[][];
  portals: MapPortal[];
  spawns: MapSpawn[];
}

export interface ClassPreset {
  id: string;
  classId: ClassId;
  gender: Gender;
  name: string;
  base: AvatarBase;
  layers: Partial<Record<EquipLayer, string>>;
}

export interface NamedAssetEntry {
  name: string;
  file: string;
}

export interface MapAssetEntry {
  name: string;
  file: string;
  tileset: string;
}

export interface AppearanceManifest {
  classes: Record<string, ClassPreset>;
  monsters: Record<string, NamedAssetEntry>;
  npcs: Record<string, NamedAssetEntry>;
  powers: Record<string, NamedAssetEntry>;
  maps: Record<string, MapAssetEntry>;
  tilesets: readonly string[];
}

/**
 * Compute the zero-based frame index for an animation section at `elapsedMs`.
 */
export function stepAnimFrame(section: AnimSection, elapsedMs: number): number {
  const { frames, durationMs, type } = section;
  if (frames <= 1 || durationMs <= 0) return 0;

  const t = Math.max(0, elapsedMs);
  if (type === 'play_once') {
    if (t >= durationMs) return frames - 1;
    return Math.min(frames - 1, Math.floor((t / durationMs) * frames));
  }
  if (type === 'back_forth') {
    const cycleLen = frames > 2 ? frames * 2 - 2 : frames;
    const pos = Math.floor(((t % durationMs) / durationMs) * cycleLen) % cycleLen;
    return pos < frames ? pos : cycleLen - pos;
  }
  // 'looped'
  return Math.min(frames - 1, Math.floor(((t % durationMs) / durationMs) * frames));
}

export interface HeadStyleOption {
  id: string;
  name: string;
  bases: readonly AvatarBase[];
}

export const HEAD_STYLES: readonly HeadStyleOption[] = [
  { id: 'head_short', name: '利落短发', bases: ['male'] },
  { id: 'head_bald', name: '禅武光头', bases: ['male'] },
  { id: 'head_long', name: '飘逸长发', bases: ['female', 'female_dark'] },
  { id: 'leather_hood', name: '游侠皮兜帽', bases: ['male', 'female', 'female_dark'] },
  { id: 'mage_hood', name: '秘法兜帽', bases: ['male', 'female', 'female_dark'] },
  { id: 'mage_hood_alt1', name: '羽灵圣冠', bases: ['male', 'female', 'female_dark'] },
  { id: 'chain_coif', name: '锁甲头巾', bases: ['male', 'female', 'female_dark'] },
  { id: 'plate_helm', name: '重装铁盔', bases: ['male', 'female', 'female_dark'] },
];

export interface HairColorOption {
  id: string;
  name: string;
  hex: string;
  tint: number;
}

export const HAIR_COLORS: readonly HairColorOption[] = [
  { id: 'natural', name: '原色', hex: '#ffffff', tint: 0xffffff },
  { id: 'gold', name: '金棕', hex: '#fcd34d', tint: 0xfcd34d },
  { id: 'crimson', name: '赤红', hex: '#f87171', tint: 0xf87171 },
  { id: 'azure', name: '冰蓝', hex: '#7dd3fc', tint: 0x7dd3fc },
  { id: 'violet', name: '紫霞', hex: '#c4b5fd', tint: 0xc4b5fd },
  { id: 'jade', name: '翠绿', hex: '#6ee7b7', tint: 0x6ee7b7 },
];

/** Return all selectable head/hairstyle presets compatible with `base`. */
export function getHeadStylesForBase(base: AvatarBase): HeadStyleOption[] {
  return HEAD_STYLES.filter((h) => h.bases.includes(base));
}

/** Resolve a saved hair/head color id into a Phaser hex tint number. */
export function resolveHairTint(colorId?: string): number {
  return HAIR_COLORS.find((c) => c.id === colorId)?.tint ?? 0xffffff;
}

/**
 * Logical appearance manifest mapping PWI 1.3.6 presets, monsters, NPCs,
 * skill VFX, and maps to Flare asset files. Swapping art later only requires
 * changing this manifest and the corresponding asset pack.
 */
export const DEFAULT_MANIFEST: AppearanceManifest = {
  classes: {
    'blademaster.male': {
      id: 'blademaster.male',
      classId: 'blademaster',
      gender: 'male',
      name: '武侠·男（人族）',
      base: 'male',
      layers: {
        head: 'head_short',
        chest: 'chain_cuirass',
        legs: 'chain_greaves',
        feet: 'chain_boots',
        hands: 'chain_gloves',
        main: 'longsword',
        off: 'buckler',
      },
    },
    'blademaster.female': {
      id: 'blademaster.female',
      classId: 'blademaster',
      gender: 'female',
      name: '武侠·女（人族）',
      base: 'female',
      layers: {
        head: 'head_long',
        chest: 'chain_cuirass',
        legs: 'chain_greaves',
        feet: 'chain_boots',
        hands: 'chain_gloves',
        main: 'greatsword',
      },
    },
    'wizard.male': {
      id: 'wizard.male',
      classId: 'wizard',
      gender: 'male',
      name: '法师·男（人族）',
      base: 'male',
      layers: {
        head: 'mage_hood',
        chest: 'mage_vest',
        legs: 'mage_skirt',
        feet: 'mage_boots',
        hands: 'mage_sleeves',
        main: 'greatstaff',
      },
    },
    'wizard.female': {
      id: 'wizard.female',
      classId: 'wizard',
      gender: 'female',
      name: '法师·女（人族）',
      base: 'female',
      layers: {
        head: 'mage_hood',
        chest: 'mage_vest',
        legs: 'mage_skirt',
        feet: 'mage_boots',
        hands: 'mage_sleeves',
        main: 'greatstaff',
      },
    },
    'archer.male': {
      id: 'archer.male',
      classId: 'archer',
      gender: 'male',
      name: '羽芒·男（羽族）',
      base: 'male',
      layers: {
        head: 'leather_hood',
        chest: 'leather_chest',
        legs: 'leather_pants',
        feet: 'leather_boots',
        hands: 'leather_gloves',
        main: 'greatbow',
      },
    },
    'archer.female': {
      id: 'archer.female',
      classId: 'archer',
      gender: 'female',
      name: '羽芒·女（羽族）',
      base: 'female',
      layers: {
        head: 'leather_hood',
        chest: 'leather_chest',
        legs: 'leather_pants',
        feet: 'leather_boots',
        hands: 'leather_gloves',
        main: 'longbow',
      },
    },
    'cleric.male': {
      id: 'cleric.male',
      classId: 'cleric',
      gender: 'male',
      name: '羽灵·男（羽族）',
      base: 'male',
      layers: {
        head: 'head_short',
        chest: 'mage_vest_alt1',
        legs: 'mage_skirt_alt1',
        feet: 'mage_boots_alt1',
        hands: 'mage_sleeves_alt1',
        main: 'rod',
        off: 'iron_buckler',
      },
    },
    'cleric.female': {
      id: 'cleric.female',
      classId: 'cleric',
      gender: 'female',
      name: '羽灵·女（羽族）',
      base: 'female',
      layers: {
        head: 'head_long',
        chest: 'mage_vest_alt1',
        legs: 'mage_skirt_alt1',
        feet: 'mage_boots_alt1',
        hands: 'mage_sleeves_alt1',
        main: 'wand',
        off: 'buckler',
      },
    },
    'barbarian.male': {
      id: 'barbarian.male',
      classId: 'barbarian',
      gender: 'male',
      name: '妖兽·男（妖族）',
      base: 'male',
      layers: {
        head: 'plate_helm',
        chest: 'plate_cuirass',
        legs: 'plate_greaves',
        feet: 'plate_boots',
        hands: 'plate_gauntlets',
        main: 'battle_axe',
        off: 'kite_shield',
      },
    },
    'venomancer.female': {
      id: 'venomancer.female',
      classId: 'venomancer',
      gender: 'female',
      name: '妖精·女（妖族）',
      base: 'female_dark',
      layers: {
        head: 'head_long',
        chest: 'mage_vest_alt2',
        legs: 'mage_skirt_alt2',
        feet: 'mage_boots_alt2',
        hands: 'mage_sleeves_alt2',
        main: 'greatstaff',
      },
    },
  },
  monsters: {
    'monster.goblin': { name: '地精喽啰', file: 'goblin' },
    'monster.goblin_elite': { name: '地精精锐', file: 'goblin_elite' },
    'monster.skeleton': { name: '骷髅兵', file: 'skeleton' },
    'monster.skeleton_archer': { name: '骷髅弓手', file: 'skeleton_archer' },
    'monster.skeleton_mage': { name: '骷髅法师', file: 'skeleton_mage' },
    'monster.zombie': { name: '腐尸', file: 'zombie' },
    'monster.antlion': { name: '沙蚁狮', file: 'antlion' },
    'monster.fire_ant': { name: '赤火蚁', file: 'fire_ant' },
    'monster.ice_ant': { name: '寒冰蚁', file: 'ice_ant' },
    'monster.minotaur': { name: '牛头统领', file: 'minotaur' },
    'monster.wyvern': { name: '翼龙', file: 'wyvern' },
    'monster.wyvern_fire': { name: '赤焰飞龙', file: 'wyvern_fire' },
  },
  npcs: {
    'npc.guild_man': { name: '帮派管理员', file: 'guild_man' },
    'npc.knight': { name: '城防卫士', file: 'knight' },
    'npc.wandering_trader': { name: '云游货郎', file: 'wandering_trader' },
    'npc.peasant_man1': { name: '村落男居民', file: 'peasant_man1' },
    'npc.peasant_woman1': { name: '村落女居民', file: 'peasant_woman1' },
  },
  powers: {
    'power.fireball': { name: '烈火符（火球）', file: 'fireball' },
    'power.icicle': { name: '涌泉/冰锥', file: 'icicle' },
    'power.lightning': { name: '引雷术', file: 'lightning' },
    'power.quake': { name: '落石/震地', file: 'quake' },
    'power.heal': { name: '静心咒（治疗）', file: 'heal' },
    'power.shield': { name: '羽盾（护盾）', file: 'shield' },
    'power.cleave': { name: '横扫千军', file: 'cleave' },
    'power.arrows': { name: '连射箭矢', file: 'arrows' },
    'power.dark_mist': { name: '万蛊蚀心（毒雾）', file: 'dark_mist' },
    'power.blast': { name: '真气爆发', file: 'blast' },
  },
  maps: {
    arrival: { name: '新手降临谷', file: 'arrival', tileset: 'tileset_grassland' },
    perdition_harbor: { name: '祖龙港口', file: 'perdition_harbor', tileset: 'tileset_grassland' },
    river_trail: { name: '河畔小径', file: 'river_trail', tileset: 'tileset_grassland' },
    goblin_cave: { name: '19级副本·地精洞穴', file: 'goblin_cave', tileset: 'tileset_cave' },
  },
  tilesets: ['tileset_grassland', 'tileset_cave'],
};
