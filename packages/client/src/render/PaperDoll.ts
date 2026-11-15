import Phaser from 'phaser';
import {
  Dir,
  HERO_LAYER_ORDER,
  stepAnimFrame,
  type AnimFrame,
  type AnimSection,
  type AnimSetDef,
  type EquipLayer,
} from '@2dpw/shared';
import { getAnimFrameTextureKey } from './FlareAssetLoader.ts';

const frameLookupCache = new WeakMap<AnimSection, Map<string, AnimFrame>>();

function getFrameLookup(sec: AnimSection): Map<string, AnimFrame> {
  let map = frameLookupCache.get(sec);
  if (!map) {
    map = new Map<string, AnimFrame>();
    for (const f of sec.list) {
      map.set(`${f.i}:${f.d}`, f);
    }
    frameLookupCache.set(sec, map);
  }
  return map;
}

function resolveSection(
  def: AnimSetDef,
  requested: string,
): { sec: AnimSection; speed: number } | null {
  if (requested === 'walk' && !def.anims.walk && def.anims.run) {
    return { sec: def.anims.run, speed: 0.55 };
  }
  const exact = def.anims[requested];
  if (exact) return { sec: exact, speed: 1 };

  const fallback = def.anims.stance ?? def.anims.power ?? Object.values(def.anims)[0] ?? null;
  return fallback ? { sec: fallback, speed: 1 } : null;
}

function applyFrame(
  img: Phaser.GameObjects.Image,
  def: AnimSetDef,
  sec: AnimSection,
  frameIdx: number,
  dir: Dir,
): void {
  const lookup = getFrameLookup(sec);
  const frame = lookup.get(`${frameIdx}:${dir}`) ?? lookup.get(`${frameIdx}:0`) ?? sec.list[0];
  if (!frame || frame.w <= 0 || frame.h <= 0) {
    img.setVisible(false);
    return;
  }

  const texKey = getAnimFrameTextureKey(def, frame);
  const frameKey = `${sec.name}:${frame.i}:${frame.d}`;
  if (!img.scene.textures.exists(texKey)) {
    img.setVisible(false);
    return;
  }

  img.setVisible(true);
  if (img.texture.key !== texKey || img.frame.name !== frameKey) {
    img.setTexture(texKey, frameKey);
  }
  img.setOrigin(frame.ox / frame.w, frame.oy / frame.h);
  img.setPosition(0, 0);
}

/**
 * Renders either a 7-layer paper-doll character (ordered per direction by
 * {@link HERO_LAYER_ORDER}) or a single-sheet sprite (monster / NPC / VFX).
 */
export class PaperDoll {
  readonly container: Phaser.GameObjects.Container;

  private mode: 'layers' | 'single' = 'layers';
  private layers: Partial<Record<EquipLayer, AnimSetDef>> = {};
  private singleDef: AnimSetDef | null = null;

  private slotImages = new Map<EquipLayer, Phaser.GameObjects.Image>();
  private singleImage: Phaser.GameObjects.Image;

  private dir: Dir = Dir.S;
  private animName = 'stance';
  private elapsedMs = 0;
  private speedScale = 1;
  private onOnceDone: (() => void) | null = null;
  private onceFired = false;

  constructor(scene: Phaser.Scene, x = 0, y = 0) {
    this.container = scene.add.container(x, y);
    this.singleImage = scene.add.image(0, 0, '__DEFAULT').setVisible(false);
    this.container.add(this.singleImage);

    const allSlots: EquipLayer[] = ['main', 'feet', 'legs', 'hands', 'chest', 'off', 'head'];
    for (const slot of allSlots) {
      const img = scene.add.image(0, 0, '__DEFAULT').setVisible(false);
      this.slotImages.set(slot, img);
      this.container.add(img);
    }
    this.reorderLayers();
  }

  /** Set world-space screen position and depth. */
  setScreenPos(sx: number, sy: number, depth = sy + 1): void {
    this.container.setPosition(sx, sy);
    this.container.setDepth(depth);
  }

  /** Switch to multi-layer paper-doll mode with the given equipment animations. */
  setLayers(layers: Partial<Record<EquipLayer, AnimSetDef>>): void {
    this.mode = 'layers';
    this.layers = layers;
    this.singleImage.setVisible(false);
    this.reorderLayers();
    this.renderCurrentFrame();
  }

  /** Switch to single-sheet sprite mode (monsters, NPCs, or VFX). */
  setSingle(def: AnimSetDef): void {
    this.mode = 'single';
    this.singleDef = def;
    for (const img of this.slotImages.values()) img.setVisible(false);
    this.container.bringToTop(this.singleImage);
    this.renderCurrentFrame();
  }

  /** Update facing direction and re-sort equipment layers accordingly. */
  setDir(dir: Dir): void {
    if (this.dir === dir) return;
    this.dir = dir;
    if (this.mode === 'layers') this.reorderLayers();
    this.renderCurrentFrame();
  }

  /** Get current facing direction. */
  getDir(): Dir {
    return this.dir;
  }

  /** Switch active animation state. */
  setAnim(animName: string, resetTime = false, onOnceDone?: () => void): void {
    const changed = this.animName !== animName;
    this.animName = animName;
    if (resetTime || changed) {
      this.elapsedMs = 0;
      this.onceFired = false;
    }
    this.onOnceDone = onOnceDone ?? null;
    this.renderCurrentFrame();
  }

  /** Set an extra playback multiplier (e.g. 1.0 default). */
  setSpeedScale(scale: number): void {
    this.speedScale = scale;
  }

  /** List available animation names for the active sprite(s). */
  getAvailableAnims(): string[] {
    const keys = new Set<string>();
    if (this.mode === 'single' && this.singleDef) {
      for (const k of Object.keys(this.singleDef.anims)) keys.add(k);
    } else {
      for (const def of Object.values(this.layers)) {
        if (!def) continue;
        for (const k of Object.keys(def.anims)) keys.add(k);
      }
      if (keys.has('run')) keys.add('walk');
    }
    return [...keys];
  }

  /** Advance animation clock and update sprite frames. */
  update(dtMs: number): void {
    this.elapsedMs += dtMs * this.speedScale;
    this.renderCurrentFrame();
  }

  /** Clean up underlying Phaser container and sprites. */
  destroy(): void {
    this.container.destroy(true);
  }

  private reorderLayers(): void {
    for (const slot of HERO_LAYER_ORDER[this.dir]) {
      const img = this.slotImages.get(slot);
      if (img) this.container.bringToTop(img);
    }
  }

  private renderCurrentFrame(): void {
    if (this.mode === 'single') {
      const def = this.singleDef;
      if (!def) {
        this.singleImage.setVisible(false);
        return;
      }
      const resolved = resolveSection(def, this.animName);
      if (!resolved) {
        this.singleImage.setVisible(false);
        return;
      }
      const t = this.elapsedMs * resolved.speed;
      const frameIdx = stepAnimFrame(resolved.sec, t);
      applyFrame(this.singleImage, def, resolved.sec, frameIdx, this.dir);
      if (resolved.sec.type === 'play_once' && t >= resolved.sec.durationMs && !this.onceFired) {
        this.onceFired = true;
        this.onOnceDone?.();
      }
      return;
    }

    let primarySection: { sec: AnimSection; speed: number } | null = null;
    for (const slot of HERO_LAYER_ORDER[this.dir]) {
      const img = this.slotImages.get(slot);
      const def = this.layers[slot];
      if (!img || !def) {
        img?.setVisible(false);
        continue;
      }
      const resolved = resolveSection(def, this.animName);
      if (!resolved) {
        img.setVisible(false);
        continue;
      }
      if (!primarySection) primarySection = resolved;
      const frameIdx = stepAnimFrame(resolved.sec, this.elapsedMs * resolved.speed);
      applyFrame(img, def, resolved.sec, frameIdx, this.dir);
    }

    if (
      primarySection &&
      primarySection.sec.type === 'play_once' &&
      this.elapsedMs * primarySection.speed >= primarySection.sec.durationMs &&
      !this.onceFired
    ) {
      this.onceFired = true;
      this.onOnceDone?.();
    }
  }
}
