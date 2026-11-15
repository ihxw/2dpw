import Phaser from 'phaser';
import {
  Dir,
  HERO_LAYER_ORDER,
  getHeadStylesForBase,
  resolveHairTint,
  stepAnimFrame,
  type AnimFrame,
  type AnimSection,
  type AnimSetDef,
  type AppearanceManifest,
  type ClassId,
  type EquipLayer,
} from '@2dpw/shared';
import { ensureAnimSetLoaded, getAnimFrameTextureKey } from './FlareAssetLoader.ts';

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
  private fxFrontGfx: Phaser.GameObjects.Graphics;
  private fxBackGfx: Phaser.GameObjects.Graphics;

  private classId?: ClassId;
  private fxTime = 0;
  private dir: Dir = Dir.S;
  private animName = 'stance';
  private elapsedMs = 0;
  private speedScale = 1;
  private onOnceDone: (() => void) | null = null;
  private onceFired = false;

  constructor(scene: Phaser.Scene, x = 0, y = 0) {
    this.container = scene.add.container(x, y);
    this.fxFrontGfx = scene.add.graphics();
    this.fxBackGfx = scene.add.graphics();
    this.singleImage = scene.add.image(0, 0, '__DEFAULT').setVisible(false);
    this.container.add([this.fxFrontGfx, this.fxBackGfx, this.singleImage]);

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
    this.classId = undefined;
    this.fxFrontGfx.clear();
    this.fxBackGfx.clear();
    this.singleDef = def;
    for (const img of this.slotImages.values()) img.setVisible(false);
    this.container.bringToTop(this.singleImage);
    this.renderCurrentFrame();
  }

  /** Set active PWI 1.3.6 class silhouette for racial wings, fox tails, and foot auras. */
  setClassStyle(classId?: ClassId): void {
    this.classId = classId;
    if (this.mode === 'layers') {
      this.reorderLayers();
      this.drawClassVfx();
    }
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

  /** Advance animation clock, class VFX, and update sprite frames. */
  update(dtMs: number): void {
    this.elapsedMs += dtMs * this.speedScale;
    this.fxTime += dtMs * 0.004;
    this.renderCurrentFrame();
    this.drawClassVfx();
  }

  /** Tint an equipment slot (e.g. hair/head color); `0xffffff` clears tinting. */
  setSlotTint(slot: EquipLayer, tint = 0xffffff): void {
    const img = this.slotImages.get(slot);
    if (!img) return;
    if (tint === 0xffffff) {
      img.clearTint();
    } else {
      img.setTint(tint);
    }
  }

  /** Clean up underlying Phaser container and sprites. */
  destroy(): void {
    this.container.destroy(true);
  }

  private reorderLayers(): void {
    this.container.sendToBack(this.fxBackGfx);
    this.container.sendToBack(this.fxFrontGfx);
    for (const slot of HERO_LAYER_ORDER[this.dir]) {
      const img = this.slotImages.get(slot);
      if (img) this.container.bringToTop(img);
    }
    const facingAway = this.dir === Dir.N || this.dir === Dir.NE || this.dir === Dir.NW;
    if (facingAway && this.classId) {
      this.container.bringToTop(this.fxBackGfx);
    }
  }

  private drawClassVfx(): void {
    this.fxFrontGfx.clear();
    this.fxBackGfx.clear();
    if (this.mode !== 'layers' || !this.classId) return;

    const pulse = 0.72 + Math.sin(this.fxTime * 1.4) * 0.24;
    const auraColor =
      this.classId === 'blademaster'
        ? 0xfacc15
        : this.classId === 'wizard'
          ? 0x38bdf8
          : this.classId === 'archer'
            ? 0x4ade80
            : this.classId === 'cleric'
              ? 0xfef08a
              : this.classId === 'barbarian'
                ? 0xf97316
                : 0xe879f9;

    // Foot Cultivation Aura (修真足底灵阵)
    this.fxFrontGfx.fillStyle(auraColor, 0.14 * pulse);
    this.fxFrontGfx.fillEllipse(0, 2, 54, 27);
    this.fxFrontGfx.lineStyle(1.6, auraColor, 0.48 * pulse);
    this.fxFrontGfx.strokeEllipse(0, 2, 54, 27);
    this.fxFrontGfx.lineStyle(1, 0xffffff, 0.25 * pulse);
    this.fxFrontGfx.strokeEllipse(0, 2, 36, 18);

    const backOffsetX: Record<Dir, number> = {
      [Dir.W]: 8,
      [Dir.NW]: 5,
      [Dir.N]: 0,
      [Dir.NE]: -5,
      [Dir.E]: -8,
      [Dir.SE]: -6,
      [Dir.S]: 0,
      [Dir.SW]: 6,
    };
    const bx = backOffsetX[this.dir];
    const g = this.fxBackGfx;

    if (this.classId === 'archer' || this.classId === 'cleric') {
      // 羽族：天生洁白双翼（护体灵羽）
      const flap = Math.sin(this.fxTime * 2.1) * 5;
      const spread = this.dir === Dir.W || this.dir === Dir.E ? 0.55 : 1;
      const tint = this.classId === 'cleric' ? 0xfef9c3 : 0xdcfce7;
      for (const side of [-1, 1] as const) {
        const s = side * spread;
        g.fillStyle(tint, 0.36);
        g.fillTriangle(bx, -58, bx + s * 42, -88 + flap, bx + s * 36, -54 + flap * 0.6);
        g.fillStyle(0xffffff, 0.78);
        g.fillTriangle(bx, -58, bx + s * 38, -82 + flap, bx + s * 28, -56 + flap * 0.5);
        g.fillStyle(0xffffff, 0.65);
        g.fillTriangle(bx, -50, bx + s * 30, -64 + flap * 0.7, bx + s * 20, -40 + flap * 0.4);
        g.fillStyle(tint, 0.55);
        g.fillTriangle(bx, -46, bx + s * 22, -44 + flap * 0.5, bx + s * 13, -28);
      }
    } else if (this.classId === 'venomancer') {
      // 妖族·妖精：九尾/灵狐仙尾
      const sway = Math.sin(this.fxTime * 2.4) * 7;
      for (const fan of [-1, 0, 1] as const) {
        const tx = bx + fan * 14 + sway * (0.7 + Math.abs(fan) * 0.25);
        const ty = -62 - (1 - Math.abs(fan)) * 8;
        g.lineStyle(9, 0xa855f7, 0.42);
        g.lineBetween(bx, -32, tx, ty);
        g.lineStyle(6, 0xe879f9, 0.72);
        g.lineBetween(bx, -32, tx, ty);
        g.fillStyle(0xfdf4ff, 0.9);
        g.fillCircle(tx, ty, 5.5);
      }
    } else if (this.classId === 'barbarian') {
      // 妖族·妖兽：白虎兽王金煞罡气
      const roar = Math.sin(this.fxTime * 2.8) * 3;
      g.lineStyle(3, 0xf59e0b, 0.45 * pulse);
      g.strokeEllipse(bx, -50, 56 + roar, 78 + roar);
      g.lineStyle(2, 0xef4444, 0.35 * pulse);
      g.strokeEllipse(bx, -54, 44 - roar, 64);
    } else if (this.classId === 'blademaster') {
      // 人族·武侠：护体飞剑金芒
      const bob1 = Math.sin(this.fxTime * 2.2) * 5;
      const bob2 = Math.cos(this.fxTime * 2.2) * 5;
      for (const [sx, sy] of [
        [bx - 22, -62 + bob1],
        [bx + 22, -62 + bob2],
      ] as const) {
        g.fillStyle(0xfef08a, 0.85);
        g.fillTriangle(sx, sy - 16, sx - 3, sy + 10, sx + 3, sy + 10);
        g.lineStyle(2, 0x38bdf8, 0.55);
        g.lineBetween(sx - 5, sy + 6, sx + 5, sy + 6);
      }
    } else if (this.classId === 'wizard') {
      // 人族·法师：冰火双灵法珠
      const angle = this.fxTime * 1.8;
      const ox1 = Math.cos(angle) * 26;
      const oy1 = -56 + Math.sin(angle) * 10;
      const ox2 = Math.cos(angle + Math.PI) * 26;
      const oy2 = -56 + Math.sin(angle + Math.PI) * 10;
      g.fillStyle(0x38bdf8, 0.45);
      g.fillCircle(ox1, oy1, 8);
      g.fillStyle(0xe0f2fe, 0.95);
      g.fillCircle(ox1, oy1, 4);
      g.fillStyle(0xf97316, 0.45);
      g.fillCircle(ox2, oy2, 8);
      g.fillStyle(0xfef3c7, 0.95);
      g.fillCircle(ox2, oy2, 4);
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

const dollLoadSeq = new WeakMap<PaperDoll, number>();

/**
 * Load all equipment layer animations for `presetId` (with optional `headStyle`
 * override and `hairColor` tint) onto `doll`, discarding stale async completions.
 */
export async function loadPresetToDoll(
  scene: Phaser.Scene,
  manifest: AppearanceManifest,
  doll: PaperDoll,
  presetId: string,
  headStyle?: string,
  hairColor?: string,
): Promise<void> {
  const preset = manifest.classes[presetId];
  if (!preset) return;

  const seq = (dollLoadSeq.get(doll) ?? 0) + 1;
  dollLoadSeq.set(doll, seq);

  const layerFiles: Partial<Record<EquipLayer, string>> = { ...preset.layers };
  if (headStyle && getHeadStylesForBase(preset.base).some((h) => h.id === headStyle)) {
    layerFiles.head = headStyle;
  }

  const entries = Object.entries(layerFiles) as [EquipLayer, string][];
  const loaded = await Promise.all(
    entries.map(async ([slot, file]) => {
      const def = await ensureAnimSetLoaded(scene, `avatar/${preset.base}/${file}`);
      return [slot, def] as const;
    }),
  );

  if (dollLoadSeq.get(doll) !== seq || !doll.container.scene || !scene.sys.isActive()) {
    return;
  }

  const layers: Partial<Record<EquipLayer, AnimSetDef>> = {};
  for (const [slot, def] of loaded) layers[slot] = def;
  doll.setLayers(layers);
  doll.setClassStyle(preset.classId);

  const bodyTint = preset.tint ?? 0xffffff;
  for (const slot of ['chest', 'legs', 'feet', 'hands', 'off', 'main'] as const) {
    doll.setSlotTint(slot, bodyTint);
  }
  doll.setSlotTint('head', resolveHairTint(hairColor));
}
