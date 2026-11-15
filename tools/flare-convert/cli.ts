import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MANIFEST, HEAD_STYLES, type AvatarBase } from '@2dpw/shared';
import { parseFlareAnimTxt, parseFlareMapTxt, parseFlareTilesetTxt } from './convert.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VENDOR_MODS = path.join(ROOT, 'assets/vendor/flare-game/mods');
const FANTASY_CORE = path.join(VENDOR_MODS, 'fantasycore');
const EMPYREAN = path.join(VENDOR_MODS, 'empyrean_campaign');
const OUT_DIR = path.join(ROOT, 'assets/generated');

const BASES: readonly AvatarBase[] = ['male', 'female', 'female_dark'];

function writeJson(relOut: string, data: unknown): void {
  const fullPath = path.join(OUT_DIR, relOut);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data));
}

function readFantasyCore(relPath: string): string {
  return fs.readFileSync(path.join(FANTASY_CORE, relPath), 'utf-8');
}

function assertImagesExist(images: Record<string, string>, owner: string): void {
  for (const [key, webUrl] of Object.entries(images)) {
    const prefix = '/assets/vendor/flare-game/';
    if (!webUrl.startsWith(prefix)) continue;
    const diskPath = path.join(ROOT, 'assets/vendor/flare-game', webUrl.slice(prefix.length));
    if (!fs.existsSync(diskPath)) {
      throw new Error(`Missing image for ${owner} (${key}): ${diskPath}`);
    }
  }
}

function main(): void {
  if (!fs.existsSync(FANTASY_CORE)) {
    throw new Error(`Flare assets not found at ${FANTASY_CORE}. Run tools/fetch-assets.sh first.`);
  }

  let count = 0;

  // 1. Collect all avatar equipment layer basenames from DEFAULT_MANIFEST + HEAD_STYLES
  const avatarFiles = new Set<string>();
  for (const preset of Object.values(DEFAULT_MANIFEST.classes)) {
    for (const file of Object.values(preset.layers)) {
      if (file) avatarFiles.add(file);
    }
  }
  for (const head of HEAD_STYLES) {
    avatarFiles.add(head.id);
  }

  // Verify every class preset's exact layers exist
  for (const preset of Object.values(DEFAULT_MANIFEST.classes)) {
    for (const [slot, file] of Object.entries(preset.layers)) {
      if (!file) continue;
      const rel = `animations/avatar/${preset.base}/${file}.txt`;
      if (!fs.existsSync(path.join(FANTASY_CORE, rel))) {
        throw new Error(`Missing avatar layer for ${preset.id}.${slot}: ${rel}`);
      }
    }
  }

  for (const base of BASES) {
    for (const file of avatarFiles) {
      const rel = `animations/avatar/${base}/${file}.txt`;
      const srcPath = path.join(FANTASY_CORE, rel);
      if (!fs.existsSync(srcPath)) continue;
      const anim = parseFlareAnimTxt(
        `avatar/${base}/${file}`,
        readFantasyCore(rel),
        readFantasyCore,
      );
      assertImagesExist(anim.images, anim.id);
      writeJson(`anims/avatar/${base}/${file}.json`, anim);
      count++;
    }
  }

  // 2. Monsters
  for (const entry of Object.values(DEFAULT_MANIFEST.monsters)) {
    const rel = `animations/enemies/${entry.file}.txt`;
    const anim = parseFlareAnimTxt(`enemies/${entry.file}`, readFantasyCore(rel), readFantasyCore);
    assertImagesExist(anim.images, anim.id);
    writeJson(`anims/enemies/${entry.file}.json`, anim);
    count++;
  }

  // 3. NPCs
  for (const entry of Object.values(DEFAULT_MANIFEST.npcs)) {
    const rel = `animations/npcs/${entry.file}.txt`;
    const anim = parseFlareAnimTxt(`npcs/${entry.file}`, readFantasyCore(rel), readFantasyCore);
    assertImagesExist(anim.images, anim.id);
    writeJson(`anims/npcs/${entry.file}.json`, anim);
    count++;
  }

  // 4. Powers (skill VFX)
  for (const entry of Object.values(DEFAULT_MANIFEST.powers)) {
    const rel = `animations/powers/${entry.file}.txt`;
    const anim = parseFlareAnimTxt(`powers/${entry.file}`, readFantasyCore(rel), readFantasyCore);
    assertImagesExist(anim.images, anim.id);
    writeJson(`anims/powers/${entry.file}.json`, anim);
    count++;
  }

  // 5. Tilesets
  for (const tsId of DEFAULT_MANIFEST.tilesets) {
    const rel = `tilesetdefs/${tsId}.txt`;
    const ts = parseFlareTilesetTxt(tsId, readFantasyCore(rel));
    assertImagesExist(ts.images, ts.id);
    writeJson(`tilesets/${tsId}.json`, ts);
    count++;
  }

  // 6. Maps
  for (const entry of Object.values(DEFAULT_MANIFEST.maps)) {
    const srcPath = path.join(EMPYREAN, `maps/${entry.file}.txt`);
    const map = parseFlareMapTxt(entry.file, fs.readFileSync(srcPath, 'utf-8'));
    map.portals = map.portals.filter((p) => p.targetMap in DEFAULT_MANIFEST.maps);
    writeJson(`maps/${entry.file}.json`, map);
    count++;
  }

  // 7. Manifest
  writeJson('manifest.json', DEFAULT_MANIFEST);
  count++;

  console.log(`[flare-convert] wrote ${count} JSON files to ${path.relative(ROOT, OUT_DIR)}`);
}

main();
