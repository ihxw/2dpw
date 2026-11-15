import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MANIFEST,
  TILE_H,
  TILE_W,
  type AnimFrame,
  type AnimSetDef,
  type AvatarBase,
  type MapDef,
  type TileDef,
  type TilesetDef,
} from '@2dpw/shared';
import { decodePng, encodePng, hash2d, RgbaCanvas, type RgbaTuple } from './png-utils.ts';

function writeFileEnsure(filePath: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

// ============================================================================
// Pass A: PWI 1.3.6 Oriental Xianxia Tilesets (tileset_pwi_xianxia & cave)
// ============================================================================

function drawPeachBlossomCluster(
  c: RgbaCanvas,
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  darkMode: boolean,
): void {
  const count = Math.floor(radius * 1.9);
  for (let i = 0; i < count; i++) {
    const a = hash2d(i, 1, seed) * Math.PI * 2;
    const r = Math.sqrt(hash2d(i, 2, seed)) * radius;
    const bx = cx + Math.cos(a) * r;
    const by = cy + Math.sin(a) * r * 0.72;
    const pr = 4 + hash2d(i, 3, seed) * 5.5;
    const shade = hash2d(i, 4, seed);
    if (darkMode) {
      const cr = shade > 0.72 ? 215 : shade > 0.35 ? 165 : 118;
      const cg = shade > 0.72 ? 120 : shade > 0.35 ? 70 : 48;
      const cb = shade > 0.72 ? 235 : shade > 0.35 ? 190 : 145;
      c.fillCircle(bx, by, pr, cr, cg, cb, 225);
    } else {
      const cr = shade > 0.72 ? 255 : shade > 0.3 ? 250 : 232;
      const cg = shade > 0.72 ? 235 : shade > 0.3 ? 176 : 124;
      const cb = shade > 0.72 ? 245 : shade > 0.3 ? 204 : 162;
      c.fillCircle(bx, by, pr, cr, cg, cb, 235);
    }
  }
}

function drawLotusFlower(c: RgbaCanvas, cx: number, cy: number, scale = 1): void {
  c.fillEllipse(cx + 2, cy + 4, 15 * scale, 8 * scale, 34, 128, 76, 220);
  c.fillEllipse(cx + 1, cy + 3, 12 * scale, 6 * scale, 48, 156, 92, 210);
  c.fillEllipse(cx - 5 * scale, cy - 2 * scale, 4.5 * scale, 6.5 * scale, 245, 138, 178, 240);
  c.fillEllipse(cx + 5 * scale, cy - 2 * scale, 4.5 * scale, 6.5 * scale, 245, 138, 178, 240);
  c.fillEllipse(cx, cy - 4 * scale, 5 * scale, 7.5 * scale, 255, 198, 220, 250);
  c.fillCircle(cx, cy - 2 * scale, 2.2 * scale, 255, 225, 100, 255);
}

function paintGroundTile(
  canvas: RgbaCanvas,
  tx: number,
  ty: number,
  tileId: number,
  caveMode: boolean,
): void {
  const cx = tx + 96;
  const cy = ty + 48;
  const hw = 96;
  const hh = 48;

  canvas.fillIsoDiamond(cx, cy, hw, hh, (dx, dy, u, v, edge): RgbaTuple => {
    const px = Math.round(cx + dx);
    const py = Math.round(cy + dy);
    const n1 = hash2d(px, py, tileId * 31);
    const n2 = hash2d(Math.floor(px / 3), Math.floor(py / 3), tileId * 77);
    const light = 1 - u * 0.06 - v * 0.04;

    if (tileId === 1 || tileId === 2) {
      // Grass (or cavern moss in cave mode)
      const baseR = caveMode ? 36 + n2 * 14 : 68 + n2 * 26 + n1 * 12;
      const baseG = caveMode ? 52 + n2 * 18 : 136 + n2 * 30 + n1 * 18;
      const baseB = caveMode ? 62 + n2 * 16 : 64 + n2 * 18 + n1 * 8;
      let r = baseR * light;
      let g = baseG * light;
      const b = baseB * light;
      if (tileId === 2 && !caveMode) {
        const petalSeed = hash2d(Math.floor(px / 2), Math.floor(py / 2), 991);
        if (petalSeed > 0.962) {
          // Soft 2x2 pink peach-blossom petals
          return [252, 162, 194, 255];
        }
      }
      if (tileId === 2 && caveMode && n1 > 0.95) {
        return [185, 115, 245, 240];
      }
      if (!caveMode && n1 > 0.88) {
        g += 18;
        r += 8;
      }
      return [r, g, b, 255];
    }

    if (tileId === 3 || tileId === 4 || tileId === 7) {
      // Imperial white-jade plaza stone (3), gold-inlay brick (4), or white-jade bridge (7)
      const baseTone = caveMode ? 68 : tileId === 7 ? 236 : 226;
      const warm = tileId === 4 ? 10 : 0;
      const shade = (n2 - 0.5) * 14 + (n1 - 0.5) * 6;
      const r = (baseTone + warm + shade) * light;
      const g = (baseTone + warm * 0.4 + shade - 2) * light;
      const b = (baseTone - warm * 0.6 + shade - (caveMode ? -14 : 6)) * light;

      // Subtle 2x2 flagstone mortar joints
      const nearCenterJoint = Math.abs(u) < 0.03 || Math.abs(v) < 0.03;
      if (nearCenterJoint && edge > 0.08) {
        return [r * 0.78, g * 0.76, b * 0.74, 255];
      }
      if (edge < 0.055) {
        if (tileId === 4 || tileId === 7) {
          return caveMode ? [150, 115, 210, 255] : [224, 186, 98, 255];
        }
        return [r * 0.84, g * 0.82, b * 0.78, 255];
      }
      if (tileId === 4) {
        const innerBox = Math.max(Math.abs(u), Math.abs(v));
        if (innerBox > 0.62 && innerBox < 0.7) {
          return caveMode ? [168, 125, 235, 255] : [218, 174, 84, 255];
        }
        if (innerBox < 0.34) {
          return caveMode ? [82, 72, 116, 255] : [188, 214, 206, 255];
        }
      }
      if (tileId === 7 && Math.abs(u) > 0.76) {
        // Carved jade balustrade edge
        return [245, 228, 180, 255];
      }
      return [r, g, b, 255];
    }

    if (tileId === 5) {
      // Sacred Taiji Bagua stone platform
      const dist = Math.hypot(u, v);
      const rBase = caveMode ? 52 : 216;
      const gBase = caveMode ? 58 : 226;
      const bBase = caveMode ? 88 : 224;
      if (edge < 0.07 || Math.abs(dist - 0.76) < 0.06) {
        return caveMode ? [220, 145, 255, 255] : [245, 204, 96, 255];
      }
      if (Math.abs(dist - 0.45) < 0.055) {
        return [78, 234, 245, 255];
      }
      if (dist < 0.32) {
        const isYang = u * 0.6 + v * 0.8 > 0;
        return isYang ? [246, 244, 236, 255] : [36, 48, 72, 255];
      }
      return [(rBase + n2 * 10) * light, (gBase + n2 * 10) * light, (bBase + n2 * 10) * light, 255];
    }

    if (tileId === 6) {
      // Shimmering Mirror-Lake Turquoise Water
      const wave = Math.sin(dx * 0.14 + dy * 0.28 + n2 * 2) * 0.5 + 0.5;
      if (caveMode) {
        const deep = 45 + wave * 35;
        return [deep * 0.65, deep * 0.9, deep * 1.45 + 35, 255];
      }
      const r = 24 + wave * 28 + n1 * 8;
      const g = 122 + wave * 42 + n1 * 10;
      const b = 152 + wave * 36 + n1 * 8;
      return [r, g, b, 255];
    }

    if (tileId === 8) {
      // Obsidian cavern basalt floor
      const crack = Math.abs(Math.sin(u * 6 + v * 4 + n2 * 2));
      const base = 34 + n2 * 16 + n1 * 8;
      if (crack < 0.06) return [88, 72, 138, 255];
      return [base * light, (base + 3) * light, (base + 18) * light, 255];
    }

    // Tile 9: Glowing magma cracks
    const flow = Math.sin(u * 5 + v * 5) * Math.cos(u * 4 - v * 6) + (n2 - 0.5) * 0.6;
    if (flow > 0.12) {
      const heat = Math.min(1, (flow - 0.12) * 1.5);
      return [225 + heat * 30, 72 + heat * 140, 16 + heat * 45, 255];
    }
    return [42 + n1 * 14, 26 + n1 * 8, 28 + n1 * 8, 255];
  });

  // Add extra crisp water lotus accents on tile 6 (in non-cave mode)
  if (tileId === 6 && !caveMode) {
    drawLotusFlower(canvas, cx + 18, cy + 4, 0.9);
  }
}

function paintObjectTile(
  canvas: RgbaCanvas,
  tx: number,
  ty: number,
  tileId: number,
  caveMode: boolean,
): void {
  const cx = tx + 96;
  const footY = ty + 240;

  // Soft ground shadow under every vertical object
  canvas.fillEllipse(cx, footY + 3, 44, 20, 12, 18, 26, 95);

  if (tileId === 10) {
    // 千年仙桃树 / Glowing Cavern Spirit Tree
    const trunkR = caveMode ? 68 : 112;
    const trunkG = caveMode ? 48 : 70;
    const trunkB = caveMode ? 76 : 52;
    canvas.drawLine(cx - 2, footY, cx - 6, footY - 58, 16, trunkR, trunkG, trunkB, 255);
    canvas.drawLine(
      cx - 6,
      footY - 58,
      cx + 8,
      footY - 108,
      12,
      trunkR + 12,
      trunkG + 8,
      trunkB + 6,
      255,
    );
    canvas.drawLine(
      cx - 6,
      footY - 58,
      cx - 34,
      footY - 102,
      9,
      trunkR + 8,
      trunkG + 6,
      trunkB + 4,
      255,
    );
    canvas.drawLine(
      cx + 4,
      footY - 82,
      cx + 38,
      footY - 114,
      8,
      trunkR + 10,
      trunkG + 6,
      trunkB + 4,
      255,
    );

    drawPeachBlossomCluster(canvas, cx - 34, footY - 116, 36, 101, caveMode);
    drawPeachBlossomCluster(canvas, cx + 34, footY - 120, 34, 102, caveMode);
    drawPeachBlossomCluster(canvas, cx, footY - 142, 44, 103, caveMode);
    return;
  }

  if (tileId === 11) {
    // 翠玉修竹丛 (Emerald Bamboo Grove)
    const stalks = [
      { dx: -22, h: 155, lean: -14 },
      { dx: -8, h: 185, lean: -4 },
      { dx: 6, h: 196, lean: 5 },
      { dx: 20, h: 165, lean: 14 },
      { dx: 30, h: 138, lean: 18 },
    ];
    for (let s = 0; s < stalks.length; s++) {
      const st = stalks[s]!;
      const x0 = cx + st.dx;
      const x1 = x0 + st.lean;
      const y1 = footY - st.h;
      const gCol = caveMode ? 125 : 158;
      const bCol = caveMode ? 155 : 88;
      canvas.drawLine(x0, footY, x1, y1, 5.5, 58, gCol, bCol, 255);
      // Bamboo node rings
      for (let seg = 22; seg < st.h - 15; seg += 24) {
        const t = seg / st.h;
        const nx = x0 + st.lean * t;
        const ny = footY - seg;
        canvas.drawLine(nx - 3.5, ny, nx + 3.5, ny, 2, 200, 232, 165, 255);
      }
      // Feathery bamboo leaf sprays
      for (let l = 0; l < 12; l++) {
        const ly = y1 + (l % 4) * 14 + 4;
        const lx = x1 + (l % 2 === 0 ? -1 : 1) * (8 + (l % 3) * 9);
        canvas.drawLine(
          x1,
          ly,
          lx,
          ly + 8,
          2.5,
          86,
          caveMode ? 170 : 196,
          caveMode ? 180 : 108,
          235,
        );
      }
    }
    return;
  }

  if (tileId === 12) {
    // 祖龙盘龙金柱 (Coiled Gold Dragon White-Jade Pillar)
    // Stepped white-jade base
    canvas.fillEllipse(cx, footY, 34, 17, 232, 228, 218, 255);
    canvas.fillEllipse(cx, footY - 8, 28, 14, 245, 240, 230, 255);
    canvas.fillRect(cx - 12, footY - 178, 24, 170, 228, 224, 212, 255);
    canvas.fillRect(cx - 5, footY - 178, 8, 170, 246, 244, 238, 255);
    // Coiled imperial gold dragon spiral + crimson silk band
    for (let y = 0; y < 148; y += 2) {
      const waveX = Math.sin(y * 0.14) * 12;
      canvas.fillCircle(cx + waveX, footY - 22 - y, 4.2, 242, 192, 64, 255);
      if (y % 28 < 6) {
        canvas.fillCircle(cx - waveX * 0.5, footY - 22 - y, 3.2, 196, 34, 38, 240);
      }
    }
    // Dragon pearl capital
    canvas.fillEllipse(cx, footY - 180, 20, 9, 235, 185, 62, 255);
    canvas.fillCircle(cx, footY - 194, 12, 255, 220, 95, 130);
    canvas.fillCircle(cx, footY - 194, 7.5, 255, 242, 168, 255);
    return;
  }

  if (tileId === 13) {
    // 朱红飞檐宫墙柱 (Imperial Vermilion Pavilion Pillar & Glazed Flying Eaves)
    canvas.fillEllipse(cx, footY, 44, 21, 220, 216, 208, 255);
    canvas.fillRect(cx - 14, footY - 138, 28, 134, 172, 30, 28, 255);
    canvas.fillRect(cx - 7, footY - 138, 10, 134, 208, 48, 42, 255);
    // Golden brackets
    canvas.fillRect(cx - 26, footY - 142, 52, 10, 228, 182, 66, 255);
    // Authentic Chinese upturned glazed cyan-turquoise flying eaves (飞檐)
    for (let k = -54; k <= 54; k++) {
      const t = Math.abs(k) / 54;
      const eaveBot = footY - 140 - Math.pow(t, 2.4) * 20;
      const eaveTop = footY - 182 + t * 28 - Math.pow(t, 3.0) * 14;
      const yTop = Math.min(eaveTop, eaveBot);
      const yBot = Math.max(eaveTop, eaveBot);
      const ridgeGlow = (1 - t) * 26;
      canvas.drawLine(cx + k, yBot, cx + k, yTop, 2.2, 26, 128 + ridgeGlow, 142 + ridgeGlow, 255);
      // Golden roof rib highlight
      canvas.setPixel(cx + k, yBot, 238, 194, 82, 255);
      canvas.setPixel(cx + k, yTop, 248, 214, 102, 255);
    }
    // Golden ridge finial pearl
    canvas.fillCircle(cx, footY - 186, 5.5, 250, 212, 86, 255);
    return;
  }

  if (tileId === 14) {
    // 仙界宫灯石柱 (Luminous Xianxia Stone Lantern)
    canvas.fillEllipse(cx, footY, 24, 12, 224, 220, 212, 255);
    canvas.fillRect(cx - 7, footY - 88, 14, 86, 216, 212, 202, 255);
    // Warm amber glow halo
    canvas.fillCircle(cx, footY - 102, 32, 255, 205, 88, 48);
    canvas.fillCircle(cx, footY - 102, 20, 255, 228, 130, 95);
    // Lantern chamber
    canvas.fillRect(cx - 14, footY - 116, 28, 26, 178, 38, 32, 255);
    canvas.fillRect(cx - 9, footY - 112, 18, 18, 255, 232, 140, 255);
    // Curved lantern roof
    canvas.drawLine(cx - 22, footY - 118, cx, footY - 134, 5, 232, 185, 72, 255);
    canvas.drawLine(cx + 22, footY - 118, cx, footY - 134, 5, 232, 185, 72, 255);
    return;
  }

  if (tileId === 15) {
    // 湖心粉荷灵石 (Scholar Rock & Lotus)
    canvas.fillCircle(cx - 6, footY - 18, 22, 92, 108, 124, 255);
    canvas.fillCircle(cx + 10, footY - 26, 18, 118, 132, 148, 255);
    canvas.fillCircle(cx - 2, footY - 40, 14, 136, 148, 162, 255);
    drawLotusFlower(canvas, cx - 22, footY + 4, 1.15);
    drawLotusFlower(canvas, cx + 22, footY + 6, 1.0);
    return;
  }

  if (tileId === 16) {
    // 镇妖紫晶碑 (Demon-Sealing Violet Crystal Monolith)
    canvas.fillEllipse(cx, footY, 30, 15, 72, 68, 92, 255);
    canvas.fillCircle(cx, footY - 90, 42, 148, 86, 245, 55);
    canvas.drawLine(cx, footY - 14, cx, footY - 156, 20, 124, 58, 212, 245);
    canvas.drawLine(cx - 3, footY - 18, cx - 2, footY - 152, 9, 212, 168, 255, 255);
    canvas.drawLine(cx - 18, footY - 14, cx - 26, footY - 82, 10, 112, 68, 198, 235);
    canvas.drawLine(cx + 18, footY - 14, cx + 28, footY - 94, 10, 142, 82, 232, 235);
    return;
  }

  // Tile 17: 赤焰盘龙火柱 (Blazing Brazier Pillar)
  canvas.fillEllipse(cx, footY, 30, 15, 62, 54, 58, 255);
  canvas.fillRect(cx - 11, footY - 94, 22, 92, 74, 62, 64, 255);
  canvas.fillEllipse(cx, footY - 96, 26, 12, 118, 88, 56, 255);
  canvas.fillCircle(cx, footY - 122, 36, 255, 96, 24, 65);
  canvas.fillEllipse(cx, footY - 120, 18, 30, 245, 76, 22, 235);
  canvas.fillEllipse(cx - 3, footY - 116, 12, 22, 255, 178, 42, 245);
  canvas.fillEllipse(cx, footY - 110, 7, 13, 255, 242, 150, 255);
}

function buildPwiTileset(id: 'tileset_pwi_xianxia' | 'tileset_pwi_cave', outDir: string): void {
  const caveMode = id === 'tileset_pwi_cave';
  const sheet = new RgbaCanvas(1536, 480);
  const tiles: Record<number, TileDef> = {};

  for (let tid = 1; tid <= 9; tid++) {
    const x = tid <= 8 ? (tid - 1) * TILE_W : 0;
    const y = tid <= 8 ? 0 : TILE_H;
    paintGroundTile(sheet, x, y, tid, caveMode);
    tiles[tid] = {
      id: tid,
      img: 'img0',
      x,
      y,
      w: TILE_W,
      h: TILE_H,
      ox: TILE_W / 2,
      oy: TILE_H / 2,
    };
  }

  for (let tid = 10; tid <= 17; tid++) {
    const x = (tid - 10) * TILE_W;
    const y = TILE_H * 2;
    paintObjectTile(sheet, x, y, tid, caveMode);
    tiles[tid] = {
      id: tid,
      img: 'img0',
      x,
      y,
      w: TILE_W,
      h: 288,
      ox: TILE_W / 2,
      oy: 240,
    };
  }

  const webImg = `/assets/generated/pwi/${id}.png`;
  writeFileEnsure(path.join(outDir, 'pwi', `${id}.png`), encodePng(sheet));

  const def: TilesetDef = {
    id,
    images: { img0: webImg },
    tiles,
  };
  writeFileEnsure(path.join(outDir, 'tilesets', `${id}.json`), JSON.stringify(def));
}

// ============================================================================
// Pass B: 4 Authentic PWI 1.3.6 Maps
// ============================================================================

function makeGrid(w: number, h: number, fill = 0): number[][] {
  return Array.from({ length: h }, () => Array<number>(w).fill(fill));
}

function buildArrivalMap(): MapDef {
  const w = 40;
  const h = 40;
  const gnd = makeGrid(w, h, 1);
  const obj = makeGrid(w, h, 0);
  const col = makeGrid(w, h, 0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Natural petal-grass scatter
      gnd[y]![x] = (x * 7 + y * 13) % 5 === 0 ? 2 : 1;

      // Perimeter forest border
      if (x <= 2 || x >= w - 3 || y <= 2 || y >= h - 3) {
        col[y]![x] = 1;
        if ((x + y) % 2 === 0) obj[y]![x] = (x * y) % 3 === 0 ? 11 : 10;
        continue;
      }

      // Mirror-Lake Lotus Stream along x in 27..30
      if (x >= 27 && x <= 30) {
        if (y >= 18 && y <= 22) {
          gnd[y]![x] = 7; // White-jade stone bridge
          col[y]![x] = 0;
        } else {
          gnd[y]![x] = 6; // Turquoise water
          col[y]![x] = 2;
          if (x === 28 && y % 6 === 2) obj[y]![x] = 15; // Lotus rock
        }
        continue;
      }

      // Central Taiji White-Jade Birth Altar (15..25, 15..25)
      if (x >= 15 && x <= 25 && y >= 15 && y <= 25) {
        const isCenter = x >= 19 && x <= 21 && y >= 19 && y <= 21;
        const isBorder = x === 15 || x === 25 || y === 15 || y === 25;
        gnd[y]![x] = isCenter ? 5 : isBorder ? 4 : 3;
      } else if (x >= 18 && x <= 22 && y >= 4 && y < 15) {
        // Northern royal path toward Dragon City
        gnd[y]![x] = x === 18 || x === 22 ? 4 : 3;
      } else if (y >= 18 && y <= 22 && x > 25 && x <= 36) {
        // Eastern trail toward Mirror Lake
        gnd[y]![x] = x > 30 ? (y === 18 || y === 22 ? 4 : 3) : 3;
      }
    }
  }

  // Symmetrical 4 corner Jade Lanterns around central 3x3 Taiji altar
  // Note: keeping (20,20) & (19,21) & (21,20) walkable, while (18,22) is blocked (1)!
  for (const [lx, ly] of [
    [18, 22],
    [22, 18],
    [18, 18],
    [22, 22],
  ] as const) {
    obj[ly]![lx] = 14;
    col[ly]![lx] = 1;
  }

  // Dragon pillars along North avenue & bridgeheads
  for (const [px, py] of [
    [17, 8],
    [23, 8],
    [17, 12],
    [23, 12],
    [26, 17],
    [26, 23],
    [31, 17],
    [31, 23],
  ] as const) {
    obj[py]![px] = 12;
    col[py]![px] = 1;
  }

  // Scenic peach-blossom & bamboo groves
  for (const [gx, gy, tile] of [
    [8, 8, 10],
    [11, 11, 10],
    [7, 14, 11],
    [10, 29, 10],
    [14, 32, 11],
    [34, 8, 10],
    [34, 13, 11],
    [34, 30, 10],
  ] as const) {
    obj[gy]![gx] = tile;
    col[gy]![gx] = 1;
  }

  return {
    id: 'arrival',
    title: '桃源镇·仙缘谷 (新手降临)',
    width: w,
    height: h,
    tileWidth: TILE_W,
    tileHeight: TILE_H,
    spawn: { x: 20, y: 20 },
    tileset: 'tileset_pwi_xianxia',
    groundLayers: [{ name: 'ground', data: gnd }],
    objectLayers: [{ name: 'object', data: obj }],
    collision: col,
    portals: [
      {
        x: 19,
        y: 5,
        w: 3,
        h: 2,
        targetMap: 'perdition_harbor',
        targetX: 24,
        targetY: 38,
        tooltip: '祖龙城·中央皇城',
      },
      {
        x: 34,
        y: 19,
        w: 2,
        h: 3,
        targetMap: 'river_trail',
        targetX: 8,
        targetY: 22,
        tooltip: '信风镇·镜湖仙踪',
      },
    ],
    spawns: [
      { kind: 'npc', id: 'peasant_woman1', x: 16, y: 17 },
      { kind: 'npc', id: 'wandering_trader', x: 24, y: 17 },
      { kind: 'npc', id: 'knight', x: 17, y: 10 },
      { kind: 'enemy', id: 'antlion', x: 9, y: 22, level: 2 },
      { kind: 'enemy', id: 'goblin', x: 32, y: 11, level: 3 },
    ],
  };
}

function buildDragonCityMap(): MapDef {
  const w = 48;
  const h = 48;
  const gnd = makeGrid(w, h, 3);
  const obj = makeGrid(w, h, 0);
  const col = makeGrid(w, h, 0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Grand Imperial City Vermilion Eaves Perimeter Walls
      if (x <= 2 || x >= w - 3 || y <= 2 || y >= h - 3) {
        col[y]![x] = 1;
        gnd[y]![x] = 4;
        if ((x === 2 || x === w - 3 || y === 2 || y === h - 3) && (x + y) % 2 === 0) {
          obj[y]![x] = 13;
        }
        continue;
      }

      const inCrossRoad = (x >= 21 && x <= 27) || (y >= 21 && y <= 27);
      const inMoatRing =
        (Math.abs(x - 24) >= 11 && Math.abs(x - 24) <= 13 && y >= 11 && y <= 37) ||
        (Math.abs(y - 24) >= 11 && Math.abs(y - 24) <= 13 && x >= 11 && x <= 37);

      if (inMoatRing) {
        if (inCrossRoad) {
          gnd[y]![x] = 7; // Imperial white-jade moat bridges
          col[y]![x] = 0;
        } else {
          gnd[y]![x] = 6; // Turquoise moat water
          col[y]![x] = 2;
          if ((x + y) % 7 === 0) obj[y]![x] = 15;
        }
        continue;
      }

      // 4 outer imperial garden corners
      if ((x < 11 || x > 37) && (y < 11 || y > 37)) {
        gnd[y]![x] = (x + y) % 4 === 0 ? 2 : 1;
        continue;
      }

      // Central Wanliu Taiji Altar (22..26, 22..26)
      if (x >= 22 && x <= 26 && y >= 22 && y <= 26) {
        gnd[y]![x] = 5;
      } else if (x >= 17 && x <= 31 && y >= 17 && y <= 31) {
        gnd[y]![x] = x === 17 || x === 31 || y === 17 || y === 31 ? 4 : 3;
      } else if (inCrossRoad) {
        gnd[y]![x] = x === 21 || x === 27 || y === 21 || y === 27 ? 4 : 3;
      }
    }
  }

  // Dragon pillars framing central Taiji plaza + palace corners
  for (const [px, py] of [
    [18, 18],
    [30, 18],
    [18, 30],
    [30, 30],
    [20, 10],
    [28, 10],
    [20, 38],
    [28, 38],
    [10, 20],
    [10, 28],
    [38, 20],
    [38, 28],
  ] as const) {
    obj[py]![px] = 12;
    col[py]![px] = 1;
  }

  // Lanterns along avenues & imperial pavilion corners + peach/bamboo gardens
  for (const [lx, ly, tile] of [
    [20, 20, 14],
    [28, 20, 14],
    [20, 28, 14],
    [28, 28, 14],
    [6, 6, 13],
    [41, 6, 13],
    [6, 41, 13],
    [41, 41, 13],
    [8, 8, 10],
    [40, 8, 10],
    [8, 40, 11],
    [40, 40, 11],
  ] as const) {
    obj[ly]![lx] = tile;
    col[ly]![lx] = 1;
  }

  return {
    id: 'perdition_harbor',
    title: '祖龙城·中央皇城 (万流归宗)',
    width: w,
    height: h,
    tileWidth: TILE_W,
    tileHeight: TILE_H,
    spawn: { x: 24, y: 24 },
    tileset: 'tileset_pwi_xianxia',
    groundLayers: [{ name: 'ground', data: gnd }],
    objectLayers: [{ name: 'object', data: obj }],
    collision: col,
    portals: [
      {
        x: 23,
        y: 41,
        w: 3,
        h: 2,
        targetMap: 'arrival',
        targetX: 20,
        targetY: 9,
        tooltip: '桃源镇·仙缘谷',
      },
      {
        x: 41,
        y: 23,
        w: 2,
        h: 3,
        targetMap: 'river_trail',
        targetX: 22,
        targetY: 9,
        tooltip: '信风镇·镜湖仙踪',
      },
      {
        x: 23,
        y: 5,
        w: 3,
        h: 2,
        targetMap: 'goblin_cave',
        targetX: 20,
        targetY: 32,
        tooltip: '19级副本·火岩洞穴',
      },
    ],
    spawns: [
      { kind: 'npc', id: 'guild_man', x: 22, y: 20 },
      { kind: 'npc', id: 'wandering_trader', x: 26, y: 20 },
      { kind: 'npc', id: 'knight', x: 20, y: 36 },
      { kind: 'npc', id: 'knight', x: 28, y: 36 },
    ],
  };
}

function buildRiverTrailMap(): MapDef {
  const w = 44;
  const h = 44;
  const gnd = makeGrid(w, h, 1);
  const obj = makeGrid(w, h, 0);
  const col = makeGrid(w, h, 0);

  for (let y = 0; y < h; y++) {
    const riverCx = 20 + Math.round(Math.sin(y * 0.22) * 3);
    for (let x = 0; x < w; x++) {
      gnd[y]![x] = (x * 5 + y * 11) % 4 === 0 ? 2 : 1;

      if (x <= 2 || x >= w - 3 || y <= 2 || y >= h - 3) {
        col[y]![x] = 1;
        if ((x + y) % 2 === 0) obj[y]![x] = 11;
        continue;
      }

      if (Math.abs(x - riverCx) <= 2) {
        if ((y >= 19 && y <= 24) || (y >= 8 && y <= 11)) {
          gnd[y]![x] = 7; // Mirror-lake stone bridges
          col[y]![x] = 0;
        } else {
          gnd[y]![x] = 6;
          col[y]![x] = 2;
          if (x === riverCx && y % 5 === 1) obj[y]![x] = 15;
        }
        continue;
      }

      if (y >= 20 && y <= 23 && x >= 4 && x <= 38) {
        gnd[y]![x] = y === 20 || y === 23 ? 4 : 3;
      } else if (x >= 20 && x <= 24 && y >= 4 && y <= 22) {
        gnd[y]![x] = x === 20 || x === 24 ? 4 : 3;
      } else if (x >= 30 && x <= 38 && y >= 17 && y <= 26) {
        gnd[y]![x] = x === 30 || x === 38 || y === 17 || y === 26 ? 4 : 3;
      }
    }
  }

  for (const [gx, gy, tile] of [
    [10, 12, 10],
    [12, 32, 10],
    [7, 29, 11],
    [32, 10, 10],
    [36, 13, 11],
    [34, 33, 10],
    [29, 16, 13],
    [29, 27, 13],
    [34, 21, 5],
  ] as const) {
    if (tile === 5) {
      gnd[gy]![gx] = 5;
    } else {
      obj[gy]![gx] = tile;
      col[gy]![gx] = 1;
    }
  }

  return {
    id: 'river_trail',
    title: '信风镇·镜湖仙踪 (野外历练)',
    width: w,
    height: h,
    tileWidth: TILE_W,
    tileHeight: TILE_H,
    spawn: { x: 8, y: 22 },
    tileset: 'tileset_pwi_xianxia',
    groundLayers: [{ name: 'ground', data: gnd }],
    objectLayers: [{ name: 'object', data: obj }],
    collision: col,
    portals: [
      {
        x: 4,
        y: 21,
        w: 2,
        h: 3,
        targetMap: 'arrival',
        targetX: 31,
        targetY: 20,
        tooltip: '桃源镇·仙缘谷',
      },
      {
        x: 21,
        y: 4,
        w: 3,
        h: 2,
        targetMap: 'perdition_harbor',
        targetX: 38,
        targetY: 24,
        tooltip: '祖龙城·中央皇城',
      },
    ],
    spawns: [
      { kind: 'npc', id: 'wandering_trader', x: 32, y: 19 },
      { kind: 'enemy', id: 'ice_ant', x: 13, y: 15, level: 8 },
      { kind: 'enemy', id: 'goblin', x: 27, y: 29, level: 10 },
      { kind: 'enemy', id: 'skeleton_archer', x: 35, y: 25, level: 12 },
    ],
  };
}

function buildFireCaveMap(): MapDef {
  const w = 40;
  const h = 40;
  const gnd = makeGrid(w, h, 8);
  const obj = makeGrid(w, h, 0);
  const col = makeGrid(w, h, 0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Cavern walls
      if (x <= 3 || x >= w - 4 || y <= 3 || y >= h - 4) {
        col[y]![x] = 1;
        gnd[y]![x] = 9;
        if ((x === 3 || x === w - 4 || y === 3 || y === h - 4) && (x + y) % 3 === 0) {
          obj[y]![x] = 16;
        }
        continue;
      }

      // Magma moat across mid-dungeon (y in 18..22), bridged at x in 17..23
      if (y >= 18 && y <= 22) {
        if (x >= 17 && x <= 23) {
          gnd[y]![x] = 7;
          col[y]![x] = 0;
        } else {
          gnd[y]![x] = 9;
          col[y]![x] = 2;
        }
        continue;
      }

      // Northern Demon Altar (16..24, 7..14)
      if (x >= 16 && x <= 24 && y >= 7 && y <= 14) {
        const isCore = x >= 19 && x <= 21 && y >= 9 && y <= 11;
        gnd[y]![x] = isCore ? 5 : 4;
      } else if (x >= 18 && x <= 22 && y >= 23 && y <= 36) {
        gnd[y]![x] = x === 18 || x === 22 ? 4 : 3;
      }
    }
  }

  for (const [fx, fy, tile] of [
    [16, 17, 17],
    [24, 17, 17],
    [16, 23, 17],
    [24, 23, 17],
    [15, 7, 16],
    [25, 7, 16],
    [15, 14, 16],
    [25, 14, 16],
    [10, 29, 17],
    [30, 29, 17],
    [10, 10, 10],
    [30, 10, 10],
  ] as const) {
    obj[fy]![fx] = tile;
    col[fy]![fx] = 1;
  }

  return {
    id: 'goblin_cave',
    title: '19级副本·火岩洞穴 (玄冥秘境)',
    width: w,
    height: h,
    tileWidth: TILE_W,
    tileHeight: TILE_H,
    spawn: { x: 20, y: 32 },
    tileset: 'tileset_pwi_cave',
    groundLayers: [{ name: 'ground', data: gnd }],
    objectLayers: [{ name: 'object', data: obj }],
    collision: col,
    portals: [
      {
        x: 19,
        y: 35,
        w: 3,
        h: 2,
        targetMap: 'perdition_harbor',
        targetX: 24,
        targetY: 9,
        tooltip: '祖龙城·中央皇城',
      },
    ],
    spawns: [
      { kind: 'enemy', id: 'fire_ant', x: 14, y: 27, level: 17 },
      { kind: 'enemy', id: 'goblin_elite', x: 26, y: 27, level: 18 },
      { kind: 'enemy', id: 'minotaur', x: 20, y: 12, level: 19 },
      { kind: 'enemy', id: 'wyvern_fire', x: 20, y: 8, level: 21 },
    ],
  };
}

// ============================================================================
// Pass C: Synthesize PWI 1.3.6 Racial & Class Head Sprite Sheets
// ============================================================================

type PwiHeadId =
  'pwi_wuxia_crown' | 'pwi_fashi_crown' | 'pwi_elf_head' | 'pwi_tiger_head' | 'pwi_fox_head';

const PWI_HEAD_SPECS: readonly { id: PwiHeadId; bases: readonly AvatarBase[] }[] = [
  { id: 'pwi_wuxia_crown', bases: ['male', 'female', 'female_dark'] },
  { id: 'pwi_fashi_crown', bases: ['male', 'female', 'female_dark'] },
  { id: 'pwi_elf_head', bases: ['male', 'female', 'female_dark'] },
  { id: 'pwi_tiger_head', bases: ['male'] },
  { id: 'pwi_fox_head', bases: ['female', 'female_dark'] },
];

const DIR_FWD: readonly { fx: number; fy: number }[] = [
  { fx: -1, fy: 0 }, // 0: W
  { fx: -0.7, fy: -0.55 }, // 1: NW
  { fx: 0, fy: -1 }, // 2: N
  { fx: 0.7, fy: -0.55 }, // 3: NE
  { fx: 1, fy: 0 }, // 4: E
  { fx: 0.7, fy: 0.55 }, // 5: SE
  { fx: 0, fy: 1 }, // 6: S
  { fx: -0.7, fy: 0.55 }, // 7: SW
];

function detectHeadAnchor(src: RgbaCanvas, fr: AnimFrame): { cx: number; topY: number } {
  let minY = fr.h;
  outer: for (let py = 0; py < fr.h; py++) {
    for (let px = 0; px < fr.w; px++) {
      if (src.getPixel(fr.x + px, fr.y + py)[3] > 32) {
        minY = py;
        break outer;
      }
    }
  }
  if (minY >= fr.h) {
    return { cx: fr.ox, topY: Math.max(0, fr.h / 4) };
  }

  let sumX = 0;
  let cnt = 0;
  for (let py = minY; py < Math.min(fr.h, minY + 18); py++) {
    for (let px = 0; px < fr.w; px++) {
      if (src.getPixel(fr.x + px, fr.y + py)[3] > 32) {
        sumX += px;
        cnt++;
      }
    }
  }
  return {
    cx: cnt > 0 ? sumX / cnt : fr.ox,
    topY: minY,
  };
}

function tintRegionHair(
  canvas: RgbaCanvas,
  dx: number,
  dy: number,
  w: number,
  topY: number,
  mode: 'ink' | 'silver' | 'white_tiger' | 'violet',
): void {
  const yStart = Math.max(0, Math.floor(topY));
  const yEnd = Math.min(canvas.height - dy, Math.ceil(topY + 28));
  for (let py = yStart; py < yEnd; py++) {
    for (let px = 0; px < w; px++) {
      const [r, g, b, a] = canvas.getPixel(dx + px, dy + py);
      if (a < 32) continue;
      // Only recolor darker hair/top-of-head pixels on upper portion or all in tiger mode
      const lum = (r + g + b) / 3;
      if (mode === 'white_tiger') {
        if (py < topY + 23) {
          const v = Math.min(252, Math.max(198, Math.round(188 + lum * 0.42)));
          canvas.setPixel(dx + px, dy + py, v, v + 1, Math.min(255, v + 4), a);
        }
      } else if (mode === 'ink') {
        if (py < topY + 14 || r + g > b * 1.4) {
          canvas.setPixel(dx + px, dy + py, r * 0.42, g * 0.42, b * 0.52, a);
        }
      } else if (mode === 'silver') {
        if (py < topY + 15) {
          const v = Math.min(248, Math.round(160 + lum * 0.52));
          canvas.setPixel(dx + px, dy + py, v, v, Math.min(255, v + 8), a);
        }
      } else if (mode === 'violet') {
        if (py < topY + 15) {
          canvas.setPixel(
            dx + px,
            dy + py,
            Math.min(255, r * 0.72 + 52),
            Math.min(255, g * 0.55 + 24),
            Math.min(255, b * 0.85 + 78),
            a,
          );
        }
      }
    }
  }
}

function drawWuxiaCrown(c: RgbaCanvas, hx: number, topY: number, d: number): void {
  const { fx, fy } = DIR_FWD[d] ?? DIR_FWD[6]!;
  // Flowing crimson silk hero ribbons behind head
  c.drawLine(hx - fx * 3, topY + 6, hx - fx * 15 - 3, topY + 16, 2.6, 212, 34, 40, 240);
  c.drawLine(hx - fx * 3, topY + 7, hx - fx * 12 + 4, topY + 21, 2.2, 238, 52, 52, 230);
  // Crimson headband
  c.fillEllipse(hx, topY + 6, 9, 3, 198, 28, 34, 245);
  // Imperial golden dragon topknot crown
  c.fillEllipse(hx, topY - 1, 5.5, 4.5, 212, 162, 46, 255);
  c.fillEllipse(hx, topY - 4, 4.2, 4.2, 250, 212, 84, 255);
  c.drawLine(hx - 4, topY - 2, hx - 7, topY - 8, 2, 255, 224, 110, 255);
  canvasGoldCrest(c, hx, topY, fx, fy);
}

function canvasGoldCrest(c: RgbaCanvas, hx: number, topY: number, fx: number, fy: number): void {
  c.drawLine(hx + 4, topY - 2, hx + 7, topY - 8, 2, 255, 224, 110, 255);
  if (fy >= 0) {
    c.fillCircle(hx + fx * 6, topY + 6, 2.2, 255, 232, 115, 255);
  }
}

function drawFashiCrown(c: RgbaCanvas, hx: number, topY: number, d: number): void {
  const { fx, fy } = DIR_FWD[d] ?? DIR_FWD[6]!;
  // Horizontal jade hairpin + purple-gold lotus crown
  c.drawLine(hx - 11, topY - 2, hx + 11, topY - 2, 2, 244, 206, 88, 255);
  c.fillCircle(hx - 12, topY - 2, 2.4, 88, 238, 248, 255);
  c.fillCircle(hx + 12, topY - 2, 2.4, 88, 238, 248, 255);
  c.fillEllipse(hx, topY - 3, 6.2, 5.2, 116, 62, 188, 255);
  c.fillEllipse(hx, topY - 6, 4, 4, 242, 196, 76, 255);
  if (fy >= -0.2) {
    c.fillCircle(hx + fx * 6, topY + 6, 2.5, 92, 242, 255, 255);
  }
}

function drawElfHeadWings(c: RgbaCanvas, hx: number, topY: number, d: number): void {
  const { fx, fy } = DIR_FWD[d] ?? DIR_FWD[6]!;
  // Lateral separation of left/right temples
  const latX = Math.abs(fx) < 0.25 ? 8.5 : Math.abs(fx) < 0.8 ? 6.5 : 3.5;
  const sideBias = -fx * 2.5;

  for (const s of [-1, 1] as const) {
    const bx = hx + s * latX + sideBias;
    const by = topY + 6;
    const wingDir = Math.abs(fx) > 0.7 ? -fx : s;
    // Layered PWI snowy-white feathered temple wings
    c.drawLine(bx, by, bx + wingDir * 12, by - 7, 4.5, 224, 244, 255, 245);
    c.drawLine(bx, by - 1, bx + wingDir * 14, by - 13, 3.8, 248, 252, 255, 255);
    c.drawLine(bx, by - 2, bx + wingDir * 10, by - 16, 3.0, 255, 255, 255, 255);
    c.drawLine(bx + wingDir * 2, by + 1, bx + wingDir * 9, by - 3, 2.5, 192, 238, 250, 235);
  }
  // Golden-emerald elf tiara
  c.fillEllipse(hx, topY + 6, 8, 2.5, 232, 196, 86, 245);
  if (fy >= 0) {
    c.fillCircle(hx + fx * 6, topY + 6, 2.2, 86, 242, 186, 255);
  }
}

function drawTigerHead(c: RgbaCanvas, hx: number, topY: number, d: number): void {
  const { fx, fy } = DIR_FWD[d] ?? DIR_FWD[6]!;
  // Broad white tiger head dome
  c.fillEllipse(hx, topY + 11, 10.5, 10.5, 244, 245, 248, 245);

  // Rounded tiger ears
  const earSep = Math.abs(fx) < 0.25 ? 8 : Math.abs(fx) < 0.8 ? 6 : 3;
  for (const s of [-1, 1] as const) {
    const ex = hx + s * earSep - fx * 1.5;
    const ey = topY + 1;
    c.fillCircle(ex, ey, 4.8, 248, 248, 252, 255);
    c.fillCircle(ex, ey + 0.5, 2.8, 52, 48, 56, 235);
    c.fillCircle(ex, ey + 1, 1.8, 236, 175, 175, 220);
  }

  // Dark charcoal tiger stripes across cheeks & temples
  c.drawLine(hx - 8, topY + 9, hx - 5, topY + 11, 1.8, 42, 44, 52, 235);
  c.drawLine(hx + 8, topY + 9, hx + 5, topY + 11, 1.8, 42, 44, 52, 235);
  c.drawLine(hx - 8, topY + 13, hx - 5, topY + 14, 1.8, 42, 44, 52, 235);
  c.drawLine(hx + 8, topY + 13, hx + 5, topY + 14, 1.8, 42, 44, 52, 235);

  if (fy > -0.25) {
    // Muzzle & glowing amber-gold beast eyes + "王" stripe
    const mx = hx + fx * 6;
    c.fillEllipse(mx, topY + 15, 5.5, 4.2, 255, 255, 255, 250);
    c.fillCircle(mx, topY + 14, 1.8, 215, 118, 128, 255);
    const eyeSep = Math.abs(fx) > 0.7 ? 2.2 : 4.2;
    c.fillCircle(mx - eyeSep * 0.7, topY + 10.5, 1.8, 255, 198, 42, 255);
    c.fillCircle(mx + eyeSep * 0.7, topY + 10.5, 1.8, 255, 198, 42, 255);
    // Golden "王" forehead emblem
    c.drawLine(mx - 2.5, topY + 5, mx + 2.5, topY + 5, 1.4, 218, 152, 32, 255);
    c.drawLine(mx, topY + 5, mx, topY + 8, 1.4, 218, 152, 32, 255);
    c.drawLine(mx - 2.5, topY + 8, mx + 2.5, topY + 8, 1.4, 218, 152, 32, 255);
  }
}

function drawFoxEarsHead(c: RgbaCanvas, hx: number, topY: number, d: number): void {
  const { fx, fy } = DIR_FWD[d] ?? DIR_FWD[6]!;
  const earSep = Math.abs(fx) < 0.25 ? 7 : Math.abs(fx) < 0.8 ? 5.5 : 3;

  for (const s of [-1, 1] as const) {
    const ex = hx + s * earSep - fx * 1.5;
    const tipX = ex + s * 4.5 - fx * 2.5;
    const baseY = topY + 4;
    const tipY = topY - 12;
    // Outer pointed fluffy fox ear
    c.drawLine(ex - 3, baseY, tipX, tipY, 3.6, 248, 240, 252, 255);
    c.drawLine(ex + 3, baseY, tipX, tipY, 3.6, 224, 196, 242, 255);
    c.drawLine(ex, baseY, tipX, tipY, 4.2, 248, 240, 252, 255);
    // Sakura-pink inner fox ear
    if (fy >= -0.35) {
      c.drawLine(ex, baseY - 1, (ex + tipX) * 0.5, tipY + 4, 2.2, 246, 148, 186, 245);
    }
  }
  // Violet-jade lotus headband & jewel
  c.fillEllipse(hx, topY + 6, 7.5, 2.4, 182, 118, 226, 235);
  if (fy >= 0) {
    c.fillCircle(hx + fx * 6, topY + 6, 2.2, 248, 168, 235, 255);
  }
}

function buildPwiHeadSet(
  headId: PwiHeadId,
  base: AvatarBase,
  flareRoot: string,
  outRoot: string,
): void {
  const srcName = base === 'male' ? 'head_short' : 'head_long';
  const baseJsonPath = path.join(outRoot, 'anims/avatar', base, `${srcName}.json`);
  const basePngPath = path.join(
    flareRoot,
    'mods/fantasycore/images/avatar',
    base,
    `${srcName}.png`,
  );

  const srcJson = JSON.parse(fs.readFileSync(baseJsonPath, 'utf-8')) as AnimSetDef;
  const srcPng = decodePng(fs.readFileSync(basePngPath));

  // Collect unique source frame boxes so we pack cleanly with 28px padding on top/left/right
  const PAD_X = 28;
  const PAD_Y = 28;
  const CELL_W = 136;
  const CELL_H = 156;

  interface PackedSlot {
    key: string;
    srcFrame: AnimFrame;
    cellX: number;
    cellY: number;
  }

  const slotMap = new Map<string, PackedSlot>();
  const slots: PackedSlot[] = [];

  for (const sec of Object.values(srcJson.anims)) {
    for (const fr of sec.list) {
      const k = `${fr.x}:${fr.y}:${fr.w}:${fr.h}:${fr.ox}:${fr.oy}`;
      if (!slotMap.has(k)) {
        const slot: PackedSlot = { key: k, srcFrame: fr, cellX: 0, cellY: 0 };
        slotMap.set(k, slot);
        slots.push(slot);
      }
    }
  }

  const cols = Math.ceil(Math.sqrt(slots.length));
  const rows = Math.ceil(slots.length / cols);
  const outPng = new RgbaCanvas(cols * CELL_W, rows * CELL_H);

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    slot.cellX = (i % cols) * CELL_W;
    slot.cellY = Math.floor(i / cols) * CELL_H;

    const fr = slot.srcFrame;
    const dx = slot.cellX + PAD_X;
    const dy = slot.cellY + PAD_Y;
    outPng.blit(srcPng, fr.x, fr.y, fr.w, fr.h, dx, dy);

    const anchor = detectHeadAnchor(srcPng, fr);
    const hx = dx + anchor.cx;
    const topY = dy + anchor.topY;

    if (headId === 'pwi_wuxia_crown') {
      tintRegionHair(outPng, dx, dy, fr.w, anchor.topY, 'ink');
      drawWuxiaCrown(outPng, hx, topY, fr.d);
    } else if (headId === 'pwi_fashi_crown') {
      tintRegionHair(outPng, dx, dy, fr.w, anchor.topY, 'ink');
      drawFashiCrown(outPng, hx, topY, fr.d);
    } else if (headId === 'pwi_elf_head') {
      tintRegionHair(outPng, dx, dy, fr.w, anchor.topY, 'silver');
      drawElfHeadWings(outPng, hx, topY, fr.d);
    } else if (headId === 'pwi_tiger_head') {
      tintRegionHair(outPng, dx, dy, fr.w, anchor.topY, 'white_tiger');
      drawTigerHead(outPng, hx, topY, fr.d);
    } else if (headId === 'pwi_fox_head') {
      tintRegionHair(outPng, dx, dy, fr.w, anchor.topY, 'violet');
      drawFoxEarsHead(outPng, hx, topY, fr.d);
    }
  }

  const webImg = `/assets/generated/pwi/avatar/${base}/${headId}.png`;
  writeFileEnsure(path.join(outRoot, 'pwi/avatar', base, `${headId}.png`), encodePng(outPng));

  const newAnims: AnimSetDef['anims'] = {};
  for (const [secKey, sec] of Object.entries(srcJson.anims)) {
    newAnims[secKey] = {
      ...sec,
      list: sec.list.map((fr) => {
        const k = `${fr.x}:${fr.y}:${fr.w}:${fr.h}:${fr.ox}:${fr.oy}`;
        const slot = slotMap.get(k)!;
        return {
          i: fr.i,
          d: fr.d,
          x: slot.cellX,
          y: slot.cellY,
          w: CELL_W,
          h: CELL_H,
          ox: fr.ox + PAD_X,
          oy: fr.oy + PAD_Y,
        };
      }),
    };
  }

  const outDef: AnimSetDef = {
    id: `avatar/${base}/${headId}`,
    images: { default: webImg },
    anims: newAnims,
  };
  writeFileEnsure(
    path.join(outRoot, 'anims/avatar', base, `${headId}.json`),
    JSON.stringify(outDef),
  );
}

/**
 * Generate all custom PWI 1.3.6 Oriental Xianxia tileset PNGs/JSONs,
 * 4 PWI world maps, and racial/class avatar head sprite sheets.
 */
export function generatePwiAssets(flareRoot: string, outRoot: string): number {
  let filesWritten = 0;

  // 1. PWI Oriental Xianxia tilesets
  buildPwiTileset('tileset_pwi_xianxia', outRoot);
  buildPwiTileset('tileset_pwi_cave', outRoot);
  filesWritten += 4;

  // 2. 4 PWI 1.3.6 maps (with valid portal links filtered by DEFAULT_MANIFEST.maps)
  const maps: MapDef[] = [
    buildArrivalMap(),
    buildDragonCityMap(),
    buildRiverTrailMap(),
    buildFireCaveMap(),
  ];
  for (const m of maps) {
    m.portals = m.portals.filter((p) => p.targetMap in DEFAULT_MANIFEST.maps);
    writeFileEnsure(path.join(outRoot, 'maps', `${m.id}.json`), JSON.stringify(m));
    filesWritten++;
  }

  // 3. PWI 1.3.6 head styles (each writes 1 PNG + 1 JSON)
  for (const spec of PWI_HEAD_SPECS) {
    for (const base of spec.bases) {
      buildPwiHeadSet(spec.id, base, flareRoot, outRoot);
      filesWritten += 2;
    }
  }

  return filesWritten;
}
