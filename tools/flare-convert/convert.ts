import type {
  AnimFrame,
  AnimPlayType,
  AnimSection,
  AnimSetDef,
  MapDef,
  MapLayer,
  MapPortal,
  MapSpawn,
  TileDef,
  TilesetDef,
} from '@2dpw/shared';

const FLARE_CORE_WEB_PREFIX = '/assets/vendor/flare-game/mods/fantasycore/';

/** Parse Flare duration literals like `'800ms'` or `'2s'` into milliseconds. */
export function parseDurationMs(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (s.endsWith('ms')) return Number(s.slice(0, -2));
  if (s.endsWith('s')) return Number(s.slice(0, -1)) * 1000;
  return Number(s);
}

function expandIncludes(
  txt: string,
  resolveInclude: (relPath: string) => string,
  seen: Set<string>,
): string {
  const out: string[] = [];
  for (const rawLine of txt.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('INCLUDE ')) {
      const rel = trimmed.slice('INCLUDE '.length).trim();
      if (!seen.has(rel)) {
        seen.add(rel);
        out.push(expandIncludes(resolveInclude(rel), resolveInclude, seen));
      }
    } else {
      out.push(rawLine);
    }
  }
  return out.join('\n');
}

function normalizeAnimType(raw: string): AnimPlayType {
  if (raw === 'play_once' || raw === 'back_forth' || raw === 'looped') return raw;
  return 'looped';
}

/**
 * Parse a Flare animation `.txt` definition into an {@link AnimSetDef}.
 * Handles `INCLUDE` directives, multi-sheet `image=<path>,<key>` declarations,
 * and copies direction 0 into 1x1 placeholder frames on non-directional powers.
 */
export function parseFlareAnimTxt(
  id: string,
  txt: string,
  resolveInclude: (relPath: string) => string = () => '',
): AnimSetDef {
  const expanded = expandIncludes(txt, resolveInclude, new Set<string>());
  const images: Record<string, string> = {};
  const anims: Record<string, AnimSection> = {};

  let current: AnimSection | null = null;

  for (const rawLine of expanded.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).trim();
      current = anims[name] ?? {
        name,
        frames: 0,
        durationMs: 0,
        type: 'looped',
        list: [],
      };
      anims[name] = current;
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();

    if (key === 'image') {
      const parts = val.split(',').map((p) => p.trim());
      const imgPath = parts[0] ?? '';
      const imgKey = parts[1] || 'default';
      if (imgPath) images[imgKey] = `${FLARE_CORE_WEB_PREFIX}${imgPath}`;
      continue;
    }

    if (!current) continue;

    if (key === 'frames') {
      current.frames = Number(val);
    } else if (key === 'duration') {
      current.durationMs = parseDurationMs(val);
    } else if (key === 'type') {
      current.type = normalizeAnimType(val);
    } else if (key === 'frame') {
      const parts = val.split(',').map((p) => p.trim());
      if (parts.length < 8) continue;
      const frame: AnimFrame = {
        i: Number(parts[0]),
        d: Number(parts[1]),
        x: Number(parts[2]),
        y: Number(parts[3]),
        w: Number(parts[4]),
        h: Number(parts[5]),
        ox: Number(parts[6]),
        oy: Number(parts[7]),
      };
      if (parts[8]) frame.img = parts[8];
      current.list.push(frame);
    }
  }

  for (const sec of Object.values(anims)) {
    if (sec.frames <= 0 && sec.list.length > 0) {
      sec.frames = Math.max(...sec.list.map((f) => f.i)) + 1;
    }
    fillNonDirectionalPlaceholders(sec.list);
  }

  return { id, images, anims };
}

function fillNonDirectionalPlaceholders(list: AnimFrame[]): void {
  const dir0ByIndex = new Map<number, AnimFrame>();
  for (const f of list) {
    if (f.d === 0 && (f.w > 1 || f.h > 1)) dir0ByIndex.set(f.i, f);
  }
  if (dir0ByIndex.size === 0) return;

  for (const f of list) {
    if (f.d === 0) continue;
    if (f.w === 1 && f.h === 1 && f.ox === 0 && f.oy === 0) {
      const src = dir0ByIndex.get(f.i);
      if (!src) continue;
      f.x = src.x;
      f.y = src.y;
      f.w = src.w;
      f.h = src.h;
      f.ox = src.ox;
      f.oy = src.oy;
      if (src.img) f.img = src.img;
    }
  }
}

/** Parse a Flare tileset definition `.txt` into a {@link TilesetDef}. */
export function parseFlareTilesetTxt(id: string, txt: string): TilesetDef {
  const images: Record<string, string> = {};
  const pathToKey = new Map<string, string>();
  const tiles: Record<number, TileDef> = {};
  let currentImgKey = '';

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();

    if (key === 'img') {
      let imgKey = pathToKey.get(val);
      if (!imgKey) {
        imgKey = `img${pathToKey.size}`;
        pathToKey.set(val, imgKey);
        images[imgKey] = `${FLARE_CORE_WEB_PREFIX}${val}`;
      }
      currentImgKey = imgKey;
    } else if (key === 'tile' && currentImgKey) {
      const parts = val.split(',').map((p) => Number(p.trim()));
      if (parts.length < 7) continue;
      const tileId = parts[0]!;
      tiles[tileId] = {
        id: tileId,
        img: currentImgKey,
        x: parts[1]!,
        y: parts[2]!,
        w: parts[3]!,
        h: parts[4]!,
        ox: parts[5]!,
        oy: parts[6]!,
      };
    }
  }

  return { id, images, tiles };
}

function stripExtPath(rawPath: string, folderPrefix: string): string {
  let s = rawPath.trim();
  if (s.startsWith(folderPrefix)) s = s.slice(folderPrefix.length);
  if (s.endsWith('.txt')) s = s.slice(0, -4);
  return s;
}

/** Parse a Flare map `.txt` into a {@link MapDef}. */
export function parseFlareMapTxt(id: string, txt: string): MapDef {
  let title = id;
  let width = 0;
  let height = 0;
  let tileWidth = 192;
  let tileHeight = 96;
  let spawn: { x: number; y: number } | null = null;
  let tileset = '';

  const groundLayers: MapLayer[] = [];
  const objectLayers: MapLayer[] = [];
  let collision: number[][] = [];
  const portals: MapPortal[] = [];
  const spawns: MapSpawn[] = [];

  type SectionKind = 'header' | 'tilesets' | 'layer' | 'event' | 'npc' | 'enemy' | 'other';
  let section: SectionKind = 'other';
  let props: Record<string, string> = {};
  let inLayerData = false;
  let layerRows: number[][] = [];

  const flushSection = (): void => {
    if (section === 'header') {
      if (props.title) title = props.title;
      if (props.width) width = Number(props.width);
      if (props.height) height = Number(props.height);
      if (props.tilewidth) tileWidth = Number(props.tilewidth);
      if (props.tileheight) tileHeight = Number(props.tileheight);
      if (props.tileset) tileset = stripExtPath(props.tileset, 'tilesetdefs/');
      if (props.hero_pos) {
        const [hx, hy] = props.hero_pos.split(',').map((n) => Number(n.trim()));
        if (Number.isFinite(hx) && Number.isFinite(hy)) spawn = { x: hx!, y: hy! };
      }
    } else if (section === 'layer') {
      const layerType = props.type ?? 'background';
      if (layerType === 'collision') {
        collision = layerRows;
      } else if (layerType === 'object' || layerType === 'snowtop') {
        objectLayers.push({ name: layerType, data: layerRows });
      } else {
        groundLayers.push({ name: layerType, data: layerRows });
      }
    } else if (section === 'event') {
      if (props.intermap && props.location) {
        const loc = props.location.split(',').map((n) => Number(n.trim()));
        const im = props.intermap.split(',').map((p) => p.trim());
        const targetMap = stripExtPath(im[0] ?? '', 'maps/');
        const portal: MapPortal = {
          x: loc[0] ?? 0,
          y: loc[1] ?? 0,
          w: loc[2] ?? 1,
          h: loc[3] ?? 1,
          targetMap,
          targetX: Number(im[1] ?? 0),
          targetY: Number(im[2] ?? 0),
        };
        if (props.tooltip) portal.tooltip = props.tooltip;
        portals.push(portal);
      }
    } else if (section === 'npc' && props.location && props.filename) {
      const loc = props.location.split(',').map((n) => Number(n.trim()));
      spawns.push({
        kind: 'npc',
        id: stripExtPath(props.filename, 'npcs/'),
        x: loc[0] ?? 0,
        y: loc[1] ?? 0,
      });
    } else if (section === 'enemy' && props.location && props.category) {
      const loc = props.location.split(',').map((n) => Number(n.trim()));
      const entry: MapSpawn = {
        kind: 'enemy',
        id: props.category.trim(),
        x: loc[0] ?? 0,
        y: loc[1] ?? 0,
      };
      if (props.level) entry.level = Number(props.level);
      spawns.push(entry);
    }

    props = {};
    inLayerData = false;
    layerRows = [];
  };

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      flushSection();
      const tag = line.slice(1, -1).trim();
      section =
        tag === 'header' ||
        tag === 'tilesets' ||
        tag === 'layer' ||
        tag === 'event' ||
        tag === 'npc' ||
        tag === 'enemy'
          ? tag
          : 'other';
      continue;
    }

    if (inLayerData) {
      const clean = line.replace(/,+$/, '');
      if (clean) {
        layerRows.push(clean.split(',').map((n) => Number(n.trim())));
      }
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();

    if (section === 'layer' && key === 'data') {
      inLayerData = true;
      const inline = val.replace(/,+$/, '');
      if (inline) layerRows.push(inline.split(',').map((n) => Number(n.trim())));
      continue;
    }

    props[key] = val;
  }

  flushSection();

  for (const p of portals) {
    if (id === 'perdition_harbor' && p.targetMap === 'perdition_harbor_cave') {
      p.targetMap = 'goblin_cave';
      p.targetX = 18;
      p.targetY = 46;
      p.tooltip = '19级副本·地精洞穴';
    } else if (id === 'goblin_cave' && p.targetMap === 'goblin_camp') {
      p.targetMap = 'perdition_harbor';
      p.targetX = 5;
      p.targetY = 14;
      p.tooltip = '祖龙港口';
    }
  }

  return {
    id,
    title,
    width,
    height,
    tileWidth,
    tileHeight,
    spawn: spawn ?? { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    tileset,
    groundLayers,
    objectLayers,
    collision,
    portals,
    spawns,
  };
}
