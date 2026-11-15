import Phaser from 'phaser';
import { TILE_H, TILE_W, cellToScreen, type MapDef, type TilesetDef } from '@2dpw/shared';
import { getTileTextureKey } from './FlareAssetLoader.ts';

/**
 * Renders an isometric Flare {@link MapDef} with per-row object depth sorting
 * and an optional collision / portal debug overlay.
 */
export class IsoMapView {
  readonly map: MapDef;
  private tileImages: Phaser.GameObjects.Image[] = [];
  private debugGfx: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    map: MapDef,
    tileset: TilesetDef,
    debugVisible = false,
  ) {
    this.map = map;
    this.buildTiles(tileset);
    this.debugGfx = scene.add.graphics().setDepth(999999);
    this.drawDebugOverlay();
    this.debugGfx.setVisible(debugVisible);
  }

  /** Check whether cell `(x, y)` is inside bounds and walkable (`collision === 0`). */
  isWalkable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return false;
    return (this.map.collision[y]?.[x] ?? 1) === 0;
  }

  /** Show or hide the collision and portal grid overlay. */
  setDebugVisible(visible: boolean): void {
    this.debugGfx.setVisible(visible);
  }

  /** Destroy all tile game objects and debug graphics. */
  destroy(): void {
    for (const img of this.tileImages) img.destroy();
    this.tileImages = [];
    this.debugGfx.destroy();
  }

  private buildTiles(tileset: TilesetDef): void {
    this.map.groundLayers.forEach((layer, layerIdx) => {
      for (let y = 0; y < layer.data.length; y++) {
        const row = layer.data[y]!;
        for (let x = 0; x < row.length; x++) {
          const tileId = row[x] ?? 0;
          if (tileId <= 0) continue;
          const tile = tileset.tiles[tileId];
          if (!tile || tile.w <= 0 || tile.h <= 0) continue;

          const { x: sx, y: sy } = cellToScreen(x, y);
          const img = this.scene.add
            .image(sx, sy, getTileTextureKey(tileset, tile), `tile:${tile.id}`)
            .setOrigin(tile.ox / tile.w, tile.oy / tile.h)
            .setDepth(-100000 + (x + y) * 10 + layerIdx);
          this.tileImages.push(img);
        }
      }
    });

    this.map.objectLayers.forEach((layer, layerIdx) => {
      for (let y = 0; y < layer.data.length; y++) {
        const row = layer.data[y]!;
        for (let x = 0; x < row.length; x++) {
          const tileId = row[x] ?? 0;
          if (tileId <= 0) continue;
          const tile = tileset.tiles[tileId];
          if (!tile || tile.w <= 0 || tile.h <= 0) continue;

          const { x: sx, y: sy } = cellToScreen(x, y);
          const img = this.scene.add
            .image(sx, sy, getTileTextureKey(tileset, tile), `tile:${tile.id}`)
            .setOrigin(tile.ox / tile.w, tile.oy / tile.h)
            .setDepth(sy + layerIdx * 0.01);
          this.tileImages.push(img);
        }
      }
    });
  }

  private drawDebugOverlay(): void {
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const g = this.debugGfx;

    const strokeDiamond = (sx: number, sy: number): void => {
      g.beginPath();
      g.moveTo(sx, sy - hh);
      g.lineTo(sx + hw, sy);
      g.lineTo(sx, sy + hh);
      g.lineTo(sx - hw, sy);
      g.closePath();
      g.strokePath();
    };

    const fillDiamond = (sx: number, sy: number): void => {
      g.beginPath();
      g.moveTo(sx, sy - hh);
      g.lineTo(sx + hw, sy);
      g.lineTo(sx, sy + hh);
      g.lineTo(sx - hw, sy);
      g.closePath();
      g.fillPath();
    };

    for (let y = 0; y < this.map.collision.length; y++) {
      const row = this.map.collision[y]!;
      for (let x = 0; x < row.length; x++) {
        const val = row[x] ?? 3;
        if (val === 3) continue;
        const { x: sx, y: sy } = cellToScreen(x, y);
        if (val === 0) {
          g.lineStyle(1, 0x22cc55, 0.35);
          strokeDiamond(sx, sy);
        } else if (val === 1) {
          g.fillStyle(0xff3344, 0.18);
          g.lineStyle(1, 0xff3344, 0.65);
          fillDiamond(sx, sy);
          strokeDiamond(sx, sy);
        } else if (val === 2) {
          g.fillStyle(0x3399ff, 0.22);
          g.lineStyle(1, 0x3399ff, 0.65);
          fillDiamond(sx, sy);
          strokeDiamond(sx, sy);
        }
      }
    }

    for (const p of this.map.portals) {
      g.fillStyle(0xffd700, 0.35);
      g.lineStyle(2, 0xffd700, 0.95);
      for (let dy = 0; dy < p.h; dy++) {
        for (let dx = 0; dx < p.w; dx++) {
          const { x: sx, y: sy } = cellToScreen(p.x + dx, p.y + dy);
          fillDiamond(sx, sy);
          strokeDiamond(sx, sy);
        }
      }
    }
  }
}
