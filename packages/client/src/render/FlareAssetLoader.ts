import Phaser from 'phaser';
import type { AnimFrame, AnimSetDef, MapDef, TileDef, TilesetDef } from '@2dpw/shared';

const jsonCache = new Map<string, Promise<unknown>>();
const animCache = new Map<string, Promise<AnimSetDef>>();
const texCache = new Map<string, Promise<Phaser.Textures.Texture>>();

/** Fetch and cache a JSON file by URL. */
export function loadJson<T>(url: string): Promise<T> {
  const cached = jsonCache.get(url);
  if (cached) return cached as Promise<T>;

  const p = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
    return res.json() as Promise<T>;
  });
  jsonCache.set(url, p);
  return p;
}

/** Load a PNG texture into Phaser's TextureManager once, deduplicating concurrent calls. */
export function ensureTexture(
  scene: Phaser.Scene,
  texKey: string,
  url: string,
): Promise<Phaser.Textures.Texture> {
  if (scene.textures.exists(texKey)) {
    return Promise.resolve(scene.textures.get(texKey));
  }
  const pending = texCache.get(texKey);
  if (pending) return pending;

  const p = new Promise<Phaser.Textures.Texture>((resolve, reject) => {
    const onComplete = (key: string): void => {
      if (key !== texKey) return;
      cleanup();
      resolve(scene.textures.get(texKey));
    };
    const onError = (file: Phaser.Loader.File): void => {
      if (file.key !== texKey) return;
      cleanup();
      texCache.delete(texKey);
      reject(new Error(`Failed to load texture ${texKey} from ${url}`));
    };
    const cleanup = (): void => {
      scene.load.off(Phaser.Loader.Events.FILE_COMPLETE, onComplete);
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    };

    scene.load.on(Phaser.Loader.Events.FILE_COMPLETE, onComplete);
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    scene.load.image(texKey, url);
    if (!scene.load.isLoading()) {
      scene.load.start();
    }
  });

  texCache.set(texKey, p);
  return p;
}

/** Texture key for a specific image sheet within an {@link AnimSetDef}. */
export function getAnimFrameTextureKey(def: AnimSetDef, frame: AnimFrame): string {
  return `anim:${def.id}:${frame.img ?? 'default'}`;
}

/** Texture key for a tile within a {@link TilesetDef}. */
export function getTileTextureKey(tileset: TilesetDef, tile: TileDef): string {
  return `ts:${tileset.id}:${tile.img}`;
}

/** Load an animation JSON definition and register all its sub-frames on Phaser textures. */
export function ensureAnimSetLoaded(scene: Phaser.Scene, animPath: string): Promise<AnimSetDef> {
  const cached = animCache.get(animPath);
  if (cached) return cached;

  const p = (async () => {
    const def = await loadJson<AnimSetDef>(`/assets/generated/anims/${animPath}.json`);
    const texByKey = new Map<string, Phaser.Textures.Texture>();

    await Promise.all(
      Object.entries(def.images).map(async ([imgKey, imgUrl]) => {
        const tex = await ensureTexture(scene, `anim:${def.id}:${imgKey}`, imgUrl);
        texByKey.set(imgKey, tex);
      }),
    );

    for (const [secName, sec] of Object.entries(def.anims)) {
      for (const f of sec.list) {
        if (f.w <= 0 || f.h <= 0) continue;
        const tex = texByKey.get(f.img ?? 'default');
        if (!tex) continue;
        const fKey = `${secName}:${f.i}:${f.d}`;
        if (!tex.has(fKey)) {
          tex.add(fKey, 0, f.x, f.y, f.w, f.h);
        }
      }
    }

    return def;
  })();

  animCache.set(animPath, p);
  return p;
}

/** Load a map JSON and its tileset JSON + PNG textures, registering every tile rect. */
export async function ensureMapAndTilesetLoaded(
  scene: Phaser.Scene,
  mapFile: string,
  tilesetFile: string,
): Promise<{ map: MapDef; tileset: TilesetDef }> {
  const [map, tileset] = await Promise.all([
    loadJson<MapDef>(`/assets/generated/maps/${mapFile}.json`),
    loadJson<TilesetDef>(`/assets/generated/tilesets/${tilesetFile}.json`),
  ]);

  const texByKey = new Map<string, Phaser.Textures.Texture>();
  await Promise.all(
    Object.entries(tileset.images).map(async ([imgKey, imgUrl]) => {
      const tex = await ensureTexture(scene, `ts:${tileset.id}:${imgKey}`, imgUrl);
      texByKey.set(imgKey, tex);
    }),
  );

  for (const tile of Object.values(tileset.tiles)) {
    if (tile.w <= 0 || tile.h <= 0) continue;
    const tex = texByKey.get(tile.img);
    if (!tex) continue;
    const fKey = `tile:${tile.id}`;
    if (!tex.has(fKey)) {
      tex.add(fKey, 0, tile.x, tile.y, tile.w, tile.h);
    }
  }

  return { map, tileset };
}
