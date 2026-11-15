import Phaser from 'phaser';
import {
  DIR_DELTA,
  Dir,
  cellToScreen,
  dirTo,
  screenToCell,
  type AnimSetDef,
  type AppearanceManifest,
  type Cell,
  type EquipLayer,
} from '@2dpw/shared';
import {
  ensureAnimSetLoaded,
  ensureMapAndTilesetLoaded,
  loadJson,
} from '../render/FlareAssetLoader.ts';
import { IsoMapView } from '../render/IsoMapView.ts';
import { PaperDoll } from '../render/PaperDoll.ts';

type CategoryKind = 'class' | 'monster' | 'npc' | 'power';

const DIR_LABELS: readonly { dir: Dir; label: string }[] = [
  { dir: Dir.W, label: '0: W (左)' },
  { dir: Dir.NW, label: '1: NW (左上)' },
  { dir: Dir.N, label: '2: N (上)' },
  { dir: Dir.NE, label: '3: NE (右上)' },
  { dir: Dir.E, label: '4: E (右)' },
  { dir: Dir.SE, label: '5: SE (右下)' },
  { dir: Dir.S, label: '6: S (下)' },
  { dir: Dir.SW, label: '7: SW (左下)' },
];

const HERO_ANIMS = ['stance', 'walk', 'run', 'swing', 'cast', 'shoot', 'block', 'hit', 'die'];
const STEP_DURATION_MS = 280;

interface ActiveVfx {
  doll: PaperDoll;
  ttlMs: number;
}

/**
 * Interactive M0.5 asset and isometric map viewer.
 * Validates map depth-occlusion, 8-dir paper-doll layering, monsters, NPCs, and skill VFX.
 */
export class ViewerScene extends Phaser.Scene {
  private manifest!: AppearanceManifest;
  private mapView: IsoMapView | null = null;
  private actor!: PaperDoll;
  private vfxList: ActiveVfx[] = [];

  private actorCell: Cell = { x: 20, y: 20 };
  private stepFrom: Cell | null = null;
  private stepTo: Cell | null = null;
  private stepElapsedMs = 0;

  private currentMapId = 'arrival';
  private category: CategoryKind = 'class';
  private presetId = 'blademaster.male';
  private selectedAnim = 'stance';
  private selectedDir: Dir = Dir.S;
  private autoRotate = false;
  private rotateTimerMs = 0;
  private debugVisible = false;
  private selectedPowerId = 'power.fireball';

  private uiEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private presetSelect!: HTMLSelectElement;
  private animSelect!: HTMLSelectElement;
  private dirSelect!: HTMLSelectElement;
  private returnScene = 'Boot';

  private keys!: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super('Viewer');
  }

  init(data?: { returnScene?: string }): void {
    this.returnScene = data?.returnScene ?? 'Boot';
  }

  create(): void {
    this.actor = new PaperDoll(this, 0, 0);
    this.actor.setDir(this.selectedDir);
    this.actor.setAnim(this.selectedAnim);

    if (this.input.keyboard) {
      this.keys = {
        w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        a: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      };
    }

    this.input.on('wheel', (_p: unknown, _objs: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const next = Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.45, 2.0);
      cam.setZoom(next);
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.event.target !== this.game.canvas) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const clicked = screenToCell(world.x, world.y);
      if (clicked.x === this.actorCell.x && clicked.y === this.actorCell.y) return;
      const d = dirTo(this.actorCell, clicked);
      this.setDirection(d);
      this.tryStartStep(d);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    void this.initViewer();
  }

  override update(_time: number, delta: number): void {
    if (!this.mapView) return;
    this.mapView.cullToCamera(this.cameras.main);

    if (this.autoRotate) {
      this.rotateTimerMs += delta;
      if (this.rotateTimerMs >= 500) {
        this.rotateTimerMs = 0;
        this.setDirection(((this.selectedDir + 1) % 8) as Dir);
      }
    }

    if (this.stepFrom && this.stepTo) {
      this.stepElapsedMs += delta;
      const t = Math.min(1, this.stepElapsedMs / STEP_DURATION_MS);
      const fx = Phaser.Math.Linear(this.stepFrom.x, this.stepTo.x, t);
      const fy = Phaser.Math.Linear(this.stepFrom.y, this.stepTo.y, t);
      const s = cellToScreen(fx, fy);
      this.actor.setScreenPos(s.x, s.y, s.y + 1);
      this.cameras.main.centerOn(s.x, s.y - 40);

      if (t >= 1) {
        this.actorCell = this.stepTo;
        this.stepFrom = null;
        this.stepTo = null;
        this.stepElapsedMs = 0;
        const held = this.readHeldDir();
        if (held !== null) {
          this.setDirection(held);
          if (!this.tryStartStep(held)) this.restoreIdleAnim();
        } else {
          this.restoreIdleAnim();
        }
        this.updateStatus();
      }
    } else {
      const held = this.readHeldDir();
      if (held !== null) {
        this.setDirection(held);
        this.tryStartStep(held);
      }
    }

    this.actor.update(delta);

    for (let i = this.vfxList.length - 1; i >= 0; i--) {
      const v = this.vfxList[i]!;
      v.doll.update(delta);
      v.ttlMs -= delta;
      if (v.ttlMs <= 0) {
        v.doll.destroy();
        this.vfxList.splice(i, 1);
      }
    }
  }

  private async initViewer(): Promise<void> {
    this.manifest = await loadJson<AppearanceManifest>('/assets/generated/manifest.json');
    this.buildUi();
    await Promise.all([
      this.loadMap(this.currentMapId),
      this.loadPreset(this.category, this.presetId),
    ]);
  }

  private async loadMap(mapId: string): Promise<void> {
    const entry = this.manifest.maps[mapId];
    if (!entry) return;
    this.currentMapId = mapId;
    this.setStatus(`加载地图 ${entry.name}…`);

    const { map, tileset } = await ensureMapAndTilesetLoaded(this, entry.file, entry.tileset);
    this.mapView?.destroy();
    this.mapView = new IsoMapView(this, map, tileset, this.debugVisible);

    this.stepFrom = null;
    this.stepTo = null;
    this.actorCell = { ...map.spawn };
    const s = cellToScreen(this.actorCell.x, this.actorCell.y);
    this.actor.setScreenPos(s.x, s.y, s.y + 1);
    this.cameras.main.centerOn(s.x, s.y - 40);
    this.updateStatus();
  }

  private async loadPreset(category: CategoryKind, presetId: string): Promise<void> {
    this.category = category;
    this.presetId = presetId;
    this.setStatus(`加载外观 ${presetId}…`);

    if (category === 'class') {
      const preset = this.manifest.classes[presetId];
      if (!preset) return;
      const entries = Object.entries(preset.layers) as [EquipLayer, string][];
      const loaded = await Promise.all(
        entries.map(async ([slot, file]) => {
          const def = await ensureAnimSetLoaded(this, `avatar/${preset.base}/${file}`);
          return [slot, def] as const;
        }),
      );
      const map: Partial<Record<EquipLayer, AnimSetDef>> = {};
      for (const [slot, def] of loaded) map[slot] = def;
      this.actor.setLayers(map);
    } else if (category === 'monster') {
      const entry = this.manifest.monsters[presetId];
      if (!entry) return;
      const def = await ensureAnimSetLoaded(this, `enemies/${entry.file}`);
      this.actor.setSingle(def);
    } else if (category === 'npc') {
      const entry = this.manifest.npcs[presetId];
      if (!entry) return;
      const def = await ensureAnimSetLoaded(this, `npcs/${entry.file}`);
      this.actor.setSingle(def);
    } else {
      const entry = this.manifest.powers[presetId];
      if (!entry) return;
      const def = await ensureAnimSetLoaded(this, `powers/${entry.file}`);
      this.actor.setSingle(def);
    }

    this.refreshAnimOptions();
    this.actor.setDir(this.selectedDir);
    this.actor.setAnim(this.selectedAnim, true);
    this.updateStatus();
  }

  private async triggerPowerVfx(powerId: string): Promise<void> {
    const entry = this.manifest.powers[powerId];
    if (!entry) return;
    const def = await ensureAnimSetLoaded(this, `powers/${entry.file}`);
    const sec = def.anims.power ?? Object.values(def.anims)[0];
    const doll = new PaperDoll(this, 0, 0);
    doll.setSingle(def);
    doll.setDir(this.selectedDir);
    doll.setAnim('power', true);
    const sx = this.actor.container.x;
    const sy = this.actor.container.y;
    doll.setScreenPos(sx, sy, sy + 2);
    this.vfxList.push({ doll, ttlMs: Math.max(400, sec?.durationMs ?? 500) });
  }

  private tryStartStep(d: Dir): boolean {
    if (!this.mapView) return false;
    const delta = DIR_DELTA[d];
    const next: Cell = { x: this.actorCell.x + delta.x, y: this.actorCell.y + delta.y };
    if (!this.mapView.isWalkable(next.x, next.y)) return false;

    this.stepFrom = { ...this.actorCell };
    this.stepTo = next;
    this.stepElapsedMs = 0;
    this.actor.setAnim(this.selectedAnim === 'walk' ? 'walk' : 'run');
    return true;
  }

  private restoreIdleAnim(): void {
    const fallback =
      this.selectedAnim === 'run' || this.selectedAnim === 'walk' ? 'stance' : this.selectedAnim;
    this.actor.setAnim(fallback);
  }

  private readHeldDir(): Dir | null {
    if (!this.keys) return null;
    const active = document.activeElement;
    if (active && (active.tagName === 'SELECT' || active.tagName === 'INPUT')) return null;

    let sx = 0;
    let sy = 0;
    if (this.keys.a.isDown || this.keys.left.isDown) sx -= 1;
    if (this.keys.d.isDown || this.keys.right.isDown) sx += 1;
    if (this.keys.w.isDown || this.keys.up.isDown) sy -= 1;
    if (this.keys.s.isDown || this.keys.down.isDown) sy += 1;
    if (sx === 0 && sy === 0) return null;

    if (sx < 0 && sy === 0) return Dir.W;
    if (sx < 0 && sy < 0) return Dir.NW;
    if (sx === 0 && sy < 0) return Dir.N;
    if (sx > 0 && sy < 0) return Dir.NE;
    if (sx > 0 && sy === 0) return Dir.E;
    if (sx > 0 && sy > 0) return Dir.SE;
    if (sx === 0 && sy > 0) return Dir.S;
    return Dir.SW;
  }

  private setDirection(d: Dir): void {
    this.selectedDir = d;
    this.actor.setDir(d);
    if (this.dirSelect) this.dirSelect.value = String(d);
  }

  private buildUi(): void {
    this.uiEl?.remove();
    const root = document.createElement('div');
    root.id = 'viewer-ui';
    Object.assign(root.style, {
      position: 'fixed',
      top: '12px',
      left: '12px',
      zIndex: '100',
      background: 'rgba(14, 16, 24, 0.88)',
      border: '1px solid #3c4257',
      borderRadius: '8px',
      padding: '10px 12px',
      color: '#e5e7eb',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      width: '280px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
    });
    root.addEventListener('pointerdown', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.textContent = 'M0.5 Flare 素材与地图预览器';
    Object.assign(title.style, { fontWeight: '700', color: '#f0d890', fontSize: '13px' });
    root.appendChild(title);

    const row = (labelText: string, control: HTMLElement): void => {
      const line = document.createElement('label');
      Object.assign(line.style, {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
      });
      const span = document.createElement('span');
      span.textContent = labelText;
      span.style.color = '#9ca3af';
      line.append(span, control);
      root.appendChild(line);
    };

    const mkSelect = (styleWidth = '175px'): HTMLSelectElement => {
      const sel = document.createElement('select');
      Object.assign(sel.style, {
        width: styleWidth,
        background: '#1c2030',
        color: '#f3f4f6',
        border: '1px solid #4b5563',
        borderRadius: '4px',
        padding: '2px 4px',
        fontSize: '12px',
      });
      return sel;
    };

    // 1. Map select
    const mapSel = mkSelect();
    for (const [id, m] of Object.entries(this.manifest.maps)) {
      mapSel.add(new Option(`${m.name} (${id})`, id));
    }
    mapSel.value = this.currentMapId;
    mapSel.onchange = () => void this.loadMap(mapSel.value);
    row('地图', mapSel);

    // 2. Category select
    const catSel = mkSelect();
    catSel.add(new Option('六职业纸娃娃', 'class'));
    catSel.add(new Option('怪物 (12种)', 'monster'));
    catSel.add(new Option('NPC (5种)', 'npc'));
    catSel.add(new Option('技能特效 (10种)', 'power'));
    catSel.value = this.category;
    catSel.onchange = () => {
      this.category = catSel.value as CategoryKind;
      this.refreshPresetOptions();
      void this.loadPreset(this.category, this.presetSelect.value);
    };
    row('分类', catSel);

    // 3. Preset select
    this.presetSelect = mkSelect();
    this.refreshPresetOptions();
    this.presetSelect.onchange = () => void this.loadPreset(this.category, this.presetSelect.value);
    row('外观', this.presetSelect);

    // 4. Anim select
    this.animSelect = mkSelect();
    for (const a of HERO_ANIMS) this.animSelect.add(new Option(a, a));
    this.animSelect.value = this.selectedAnim;
    this.animSelect.onchange = () => {
      this.selectedAnim = this.animSelect.value;
      this.actor.setAnim(this.selectedAnim, true);
    };
    row('动作', this.animSelect);

    // 5. Direction select + auto-rotate
    this.dirSelect = mkSelect();
    for (const item of DIR_LABELS) {
      this.dirSelect.add(new Option(item.label, String(item.dir)));
    }
    this.dirSelect.value = String(this.selectedDir);
    this.dirSelect.onchange = () => this.setDirection(Number(this.dirSelect.value) as Dir);
    row('方向', this.dirSelect);

    const rotCheck = document.createElement('input');
    rotCheck.type = 'checkbox';
    rotCheck.checked = this.autoRotate;
    rotCheck.onchange = () => {
      this.autoRotate = rotCheck.checked;
    };
    row('自动旋转 8 方向', rotCheck);

    // 6. Power VFX trigger
    const vfxWrap = document.createElement('div');
    Object.assign(vfxWrap.style, { display: 'flex', gap: '4px', width: '175px' });
    const vfxSel = mkSelect('122px');
    for (const [id, p] of Object.entries(this.manifest.powers)) {
      vfxSel.add(new Option(p.name, id));
    }
    vfxSel.value = this.selectedPowerId;
    vfxSel.onchange = () => {
      this.selectedPowerId = vfxSel.value;
    };
    const vfxBtn = document.createElement('button');
    vfxBtn.textContent = '释放';
    Object.assign(vfxBtn.style, {
      flex: '1',
      background: '#3b4d7a',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '12px',
    });
    vfxBtn.onclick = () => void this.triggerPowerVfx(this.selectedPowerId);
    vfxWrap.append(vfxSel, vfxBtn);
    row('技能特效', vfxWrap);

    // 7. Debug collision toggle
    const dbgCheck = document.createElement('input');
    dbgCheck.type = 'checkbox';
    dbgCheck.checked = this.debugVisible;
    dbgCheck.onchange = () => {
      this.debugVisible = dbgCheck.checked;
      this.mapView?.setDebugVisible(this.debugVisible);
    };
    row('阻挡与传送网格', dbgCheck);

    // 8. Status & back button
    this.statusEl = document.createElement('div');
    Object.assign(this.statusEl.style, {
      color: '#9ca3af',
      fontSize: '11px',
      borderTop: '1px solid #2b3042',
      paddingTop: '6px',
    });
    root.appendChild(this.statusEl);

    const hint = document.createElement('div');
    hint.textContent = '操作：WASD/方向键 或 点击地面步进，滚轮缩放';
    hint.style.color = '#6b7280';
    hint.style.fontSize = '11px';
    root.appendChild(hint);

    const backBtn = document.createElement('button');
    backBtn.textContent = this.returnScene === 'World' ? '返回游戏世界' : '返回启动页';
    Object.assign(backBtn.style, {
      background: '#272b3b',
      color: '#d1d5db',
      border: '1px solid #4b5563',
      borderRadius: '4px',
      padding: '4px',
      cursor: 'pointer',
      fontSize: '12px',
    });
    backBtn.onclick = () => this.scene.start(this.returnScene);
    root.appendChild(backBtn);

    document.body.appendChild(root);
    this.uiEl = root;
    this.updateStatus();
  }

  private refreshPresetOptions(): void {
    this.presetSelect.innerHTML = '';
    const source =
      this.category === 'class'
        ? this.manifest.classes
        : this.category === 'monster'
          ? this.manifest.monsters
          : this.category === 'npc'
            ? this.manifest.npcs
            : this.manifest.powers;

    for (const [id, entry] of Object.entries(source)) {
      this.presetSelect.add(new Option(entry.name, id));
    }
    const first = Object.keys(source)[0] ?? '';
    if (first && !source[this.presetId]) {
      this.presetId = first;
    }
    this.presetSelect.value = this.presetId;
  }

  private refreshAnimOptions(): void {
    const avail = this.actor.getAvailableAnims();
    if (avail.length === 0) return;
    this.animSelect.innerHTML = '';
    for (const a of avail) this.animSelect.add(new Option(a, a));
    if (!avail.includes(this.selectedAnim)) {
      this.selectedAnim = avail.includes('stance') ? 'stance' : avail[0]!;
    }
    this.animSelect.value = this.selectedAnim;
  }

  private setStatus(msg: string): void {
    if (this.statusEl) this.statusEl.textContent = msg;
  }

  private updateStatus(): void {
    const m = this.manifest?.maps[this.currentMapId];
    const portals = this.mapView?.map.portals.length ?? 0;
    this.setStatus(
      `${m?.name ?? this.currentMapId} | 坐标 (${this.actorCell.x}, ${this.actorCell.y}) | 传送点 ${portals}`,
    );
  }

  private cleanup(): void {
    this.uiEl?.remove();
    this.uiEl = null;
    this.mapView?.destroy();
    this.mapView = null;
    for (const v of this.vfxList) v.doll.destroy();
    this.vfxList = [];
  }
}
