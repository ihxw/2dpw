import Phaser from 'phaser';
import {
  TILE_H,
  TILE_W,
  cellToScreen,
  isCellWalkable,
  type MapDef,
  type MapLayer,
  type TilesetDef,
} from '@2dpw/shared';
import { getTileTextureKey } from './FlareAssetLoader.ts';

interface TileNode {
  img: Phaser.GameObjects.Image;
  sx: number;
  sy: number;
}

/**
 * Renders an isometric Flare {@link MapDef} with per-row object depth sorting,
 * camera-view culling, and an optional collision / portal debug overlay.
 */
export class IsoMapView {
  readonly map: MapDef;
  private tiles: TileNode[] = [];
  private debugGfx: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    map: MapDef,
    tileset: TilesetDef,
    debugVisible = false,
  ) {
    this.map = map;
    this.buildLayerGroup(map.groundLayers, tileset, (x, y, idx) => -100000 + (x + y) * 10 + idx);
    this.buildLayerGroup(map.objectLayers, tileset, (_x, _y, idx, sy) => sy + idx * 0.01);
    this.debugGfx = scene.add.graphics().setDepth(999999);
    this.drawDebugOverlay();
    this.debugGfx.setVisible(debugVisible);
  }

  /** Check whether cell `(x, y)` is inside bounds and walkable (`collision === 0`). */
  isWalkable(x: number, y: number): boolean {
    return isCellWalkable(this.map.collision, x, y);
  }

  /** Hide tiles outside `cam.worldView` expanded by `pad` pixels (handles tall trees). */
  cullToCamera(cam: Phaser.Cameras.Scene2D.Camera, pad = 384): void {
    const view = cam.worldView;
    const minX = view.left - pad;
    const maxX = view.right + pad;
    const minY = view.top - pad;
    const maxY = view.bottom + pad;

    for (const node of this.tiles) {
      const vis = node.sx >= minX && node.sx <= maxX && node.sy >= minY && node.sy <= maxY;
      if (node.img.visible !== vis) node.img.setVisible(vis);
    }
  }

  /** Show or hide the collision and portal grid overlay. */
  setDebugVisible(visible: boolean): void {
    this.debugGfx.setVisible(visible);
  }

  /** Destroy all tile game objects and debug graphics. */
  destroy(): void {
    for (const node of this.tiles) node.img.destroy();
    this.tiles = [];
    this.debugGfx.destroy();
  }

  private buildLayerGroup(
    layers: MapLayer[],
    tileset: TilesetDef,
    depthFor: (x: number, y: number, layerIdx: number, sy: number) => number,
  ): void {
    layers.forEach((layer, layerIdx) => {
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
            .setDepth(depthFor(x, y, layerIdx, sy));
          this.tiles.push({ img, sx, sy });
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
