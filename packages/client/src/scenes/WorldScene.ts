import Phaser from 'phaser';
import {
  DEFAULT_MANIFEST,
  Dir,
  RUN_STEP_MS,
  TILE_H,
  TILE_W,
  WALK_STEP_MS,
  canStep,
  cellToScreen,
  findPath,
  pathToSteps,
  screenToCell,
  type AnimSetDef,
  type AppearanceManifest,
  type Cell,
  type EquipLayer,
  type MoveStep,
  type PlayerSummary,
  type S2C,
} from '@2dpw/shared';
import { Connection, type ConnState } from '../net/Connection.ts';
import {
  ensureAnimSetLoaded,
  ensureMapAndTilesetLoaded,
  loadJson,
} from '../render/FlareAssetLoader.ts';
import { IsoMapView } from '../render/IsoMapView.ts';
import { PaperDoll } from '../render/PaperDoll.ts';

export interface NetBridge {
  conn: Connection;
  setHandlers: (onState: (s: ConnState) => void, onMessage: (m: S2C) => void) => void;
}

interface RemotePeer {
  summary: PlayerSummary;
  doll: PaperDoll;
  label: Phaser.GameObjects.Text;
  from: Cell;
  to: Cell;
  elapsedMs: number;
  durationMs: number;
  moving: boolean;
}

const STEP_ANIM_SPEED_MS = 520;

/**
 * M1 multiplayer world scene:
 * renders the active isometric map with camera culling, runs client-side A* pathfinding
 * and step prediction, reconciles authoritative server corrections/AOI peers, and handles
 * portal map transitions.
 */
export class WorldScene extends Phaser.Scene {
  private bridge!: NetBridge;
  private manifest: AppearanceManifest = DEFAULT_MANIFEST;
  private mapView: IsoMapView | null = null;
  private portalLabels: Phaser.GameObjects.Text[] = [];
  private targetGfx!: Phaser.GameObjects.Graphics;

  private selfId = '';
  private presetId = 'blademaster.male';
  private currentMapId = '';
  private actor!: PaperDoll;
  private selfLabel!: Phaser.GameObjects.Text;
  private peers = new Map<string, RemotePeer>();

  private actorCell: Cell = { x: 20, y: 20 };
  private stepFrom: Cell | null = null;
  private stepTo: Cell | null = null;
  private stepElapsedMs = 0;
  private stepDurationMs = WALK_STEP_MS;
  private pendingPath: MoveStep[] = [];
  private seq = 0;
  private loadEpoch = 0;

  private runMode = false;
  private debugVisible = false;

  private uiEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private presetSelect!: HTMLSelectElement;
  private mapSelect!: HTMLSelectElement;

  private keys!: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    shift: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super('World');
  }

  create(): void {
    this.actor = new PaperDoll(this, 0, 0);
    this.actor.setDir(Dir.S);
    this.actor.setAnim('stance');

    this.selfLabel = this.add
      .text(0, -135, '我', {
        fontSize: '13px',
        color: '#fef08a',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(850000);

    this.targetGfx = this.add.graphics().setDepth(-1).setVisible(false);

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
        shift: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      };
    }

    this.input.on('wheel', (_p: unknown, _objs: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.5, 2.0));
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.event.target !== this.game.canvas || !this.mapView) return;
      const worldPt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const goal = screenToCell(worldPt.x, worldPt.y);
      const start = this.stepTo ?? this.actorCell;
      if (goal.x === start.x && goal.y === start.y) return;

      const path = findPath(this.mapView.map.collision, start, goal);
      if (path.length === 0) return;

      const allowRun = this.wantRun() || pointer.rightButtonDown();
      this.pendingPath = pathToSteps(start, path, allowRun);
      this.drawTargetMarker(goal);

      if (!this.stepTo && this.pendingPath.length > 0) {
        const next = this.pendingPath.shift()!;
        this.beginStep(next.dir, next.steps);
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    this.setupUi();
    void this.initWorld();
  }

  override update(_time: number, delta: number): void {
    if (this.mapView) {
      this.mapView.cullToCamera(this.cameras.main);
    }

    if (this.stepFrom && this.stepTo) {
      this.stepElapsedMs += delta;
      const t = Math.min(1, this.stepElapsedMs / this.stepDurationMs);
      const fx = Phaser.Math.Linear(this.stepFrom.x, this.stepTo.x, t);
      const fy = Phaser.Math.Linear(this.stepFrom.y, this.stepTo.y, t);
      this.positionSelf(fx, fy);

      if (t >= 1) {
        this.stepFrom = null;
        this.stepTo = null;
        this.stepElapsedMs = 0;
        this.positionSelf(this.actorCell.x, this.actorCell.y);
        this.updateStatus();

        const held = this.readHeldDir();
        if (held !== null) {
          this.pendingPath = [];
          this.targetGfx.setVisible(false);
          this.beginStep(held, this.wantRun() ? 2 : 1);
        } else if (this.pendingPath.length > 0) {
          const next = this.pendingPath.shift()!;
          this.beginStep(next.dir, next.steps);
        } else {
          this.targetGfx.setVisible(false);
          this.actor.setAnim('stance');
        }
      }
    } else if (this.mapView && this.selfId) {
      const held = this.readHeldDir();
      if (held !== null) {
        this.pendingPath = [];
        this.targetGfx.setVisible(false);
        this.beginStep(held, this.wantRun() ? 2 : 1);
      } else if (this.pendingPath.length > 0) {
        const next = this.pendingPath.shift()!;
        this.beginStep(next.dir, next.steps);
      }
    }

    this.actor.update(delta);

    for (const peer of this.peers.values()) {
      if (peer.moving) {
        peer.elapsedMs += delta;
        const t = Math.min(1, peer.elapsedMs / peer.durationMs);
        const fx = Phaser.Math.Linear(peer.from.x, peer.to.x, t);
        const fy = Phaser.Math.Linear(peer.from.y, peer.to.y, t);
        const s = cellToScreen(fx, fy);
        peer.doll.setScreenPos(s.x, s.y, s.y + 1);
        peer.label.setPosition(s.x, s.y - 135);
        if (t >= 1) {
          peer.moving = false;
          peer.from = { ...peer.to };
          peer.doll.setAnim('stance');
        }
      }
      peer.doll.update(delta);
    }
  }

  private async initWorld(): Promise<void> {
    this.manifest = await loadJson<AppearanceManifest>('/assets/generated/manifest.json').catch(
      () => DEFAULT_MANIFEST,
    );
    this.populateSelects();

    let bridge = this.game.registry.get('netBridge') as NetBridge | undefined;
    if (!bridge) {
      let onState: (s: ConnState) => void = () => {};
      let onMsg: (m: S2C) => void = () => {};
      const conn = new Connection(
        (s) => onState(s),
        (m) => onMsg(m),
      );
      bridge = {
        conn,
        setHandlers: (sCb, mCb) => {
          onState = sCb;
          onMsg = mCb;
        },
      };
      this.game.registry.set('netBridge', bridge);
      conn.connect();
    }
    this.bridge = bridge;

    this.bridge.setHandlers(
      (state) => {
        if (state === 'connected') {
          this.bridge.conn.send({ t: 'join', presetId: this.presetId });
        }
        this.updateStatus();
      },
      (msg) => this.handleServerMessage(msg),
    );

    if (this.bridge.conn.state === 'connected') {
      this.bridge.conn.send({ t: 'join', presetId: this.presetId });
    }
  }

  private handleServerMessage(msg: S2C): void {
    switch (msg.t) {
      case 'welcome':
        this.bridge.conn.send({ t: 'join', presetId: this.presetId });
        return;
      case 'pong':
        this.updateStatus();
        return;
      case 'joined':
        void this.applyJoined(msg.self, msg.peers);
        return;
      case 'peerEnter':
        void this.addOrUpdatePeer(msg.peer);
        return;
      case 'peerLeave':
        this.removePeer(msg.id);
        this.updateStatus();
        return;
      case 'peerPreset':
        if (msg.id === this.selfId) {
          this.presetId = msg.presetId;
          if (this.presetSelect) this.presetSelect.value = msg.presetId;
          void this.applyDollPreset(this.actor, msg.presetId);
          this.updateSelfLabel();
        } else {
          const peer = this.peers.get(msg.id);
          if (peer) {
            peer.summary.presetId = msg.presetId;
            void this.applyDollPreset(peer.doll, msg.presetId);
            peer.label.setText(this.formatLabel(peer.summary));
          }
        }
        return;
      case 'entityMoved':
        if (msg.id === this.selfId) {
          if (!this.stepTo && (this.actorCell.x !== msg.x || this.actorCell.y !== msg.y)) {
            this.actorCell = { x: msg.x, y: msg.y };
            this.positionSelf(msg.x, msg.y);
          }
          return;
        }
        this.movePeer(msg.id, msg.x, msg.y, msg.dir, msg.steps);
        return;
      case 'correct':
        this.stepFrom = null;
        this.stepTo = null;
        this.stepElapsedMs = 0;
        this.pendingPath = [];
        this.targetGfx.setVisible(false);
        this.actorCell = { x: msg.x, y: msg.y };
        this.actor.setDir(msg.dir);
        this.actor.setAnim('stance');
        this.positionSelf(msg.x, msg.y);
        this.updateStatus(`已校正 (${msg.reason})`);
        return;
    }
  }

  private async applyJoined(self: PlayerSummary, peers: PlayerSummary[]): Promise<void> {
    const epoch = ++this.loadEpoch;
    this.selfId = self.id;
    this.presetId = self.presetId;
    if (this.presetSelect) this.presetSelect.value = self.presetId;
    if (this.mapSelect) this.mapSelect.value = self.mapId;

    this.stepFrom = null;
    this.stepTo = null;
    this.stepElapsedMs = 0;
    this.pendingPath = [];
    this.targetGfx.setVisible(false);

    for (const id of [...this.peers.keys()]) this.removePeer(id);

    const mapChanged = this.currentMapId !== self.mapId || !this.mapView;
    if (mapChanged) {
      const entry = this.manifest.maps[self.mapId];
      if (!entry) return;
      this.updateStatus(`加载地图 ${entry.name}…`);
      const { map, tileset } = await ensureMapAndTilesetLoaded(this, entry.file, entry.tileset);
      if (epoch !== this.loadEpoch) return;

      this.clearPortalLabels();
      this.mapView?.destroy();
      this.mapView = new IsoMapView(this, map, tileset, this.debugVisible);
      this.currentMapId = self.mapId;

      for (const p of map.portals) {
        const s = cellToScreen(p.x + (p.w - 1) / 2, p.y + (p.h - 1) / 2);
        const destName = this.manifest.maps[p.targetMap]?.name ?? p.tooltip ?? p.targetMap;
        const lbl = this.add
          .text(s.x, s.y - 24, `传送 → ${destName}`, {
            fontSize: '12px',
            color: '#ffd700',
            backgroundColor: 'rgba(15, 20, 35, 0.72)',
            padding: { x: 6, y: 2 },
          })
          .setOrigin(0.5, 1)
          .setDepth(800000);
        this.portalLabels.push(lbl);
      }
    }

    this.actorCell = { x: self.x, y: self.y };
    this.actor.setDir(self.dir);
    this.actor.setAnim('stance');
    this.positionSelf(self.x, self.y);
    this.updateSelfLabel();

    await this.applyDollPreset(this.actor, self.presetId);
    if (epoch !== this.loadEpoch) return;

    await Promise.all(peers.map((p) => this.addOrUpdatePeer(p)));
    this.updateStatus();
  }

  private async addOrUpdatePeer(summary: PlayerSummary): Promise<void> {
    if (summary.id === this.selfId) return;
    const existing = this.peers.get(summary.id);
    if (existing) {
      existing.summary = summary;
      existing.from = { x: summary.x, y: summary.y };
      existing.to = { x: summary.x, y: summary.y };
      existing.moving = false;
      const s = cellToScreen(summary.x, summary.y);
      existing.doll.setScreenPos(s.x, s.y, s.y + 1);
      existing.doll.setDir(summary.dir);
      existing.label.setPosition(s.x, s.y - 135);
      existing.label.setText(this.formatLabel(summary));
      return;
    }

    const s = cellToScreen(summary.x, summary.y);
    const doll = new PaperDoll(this, s.x, s.y);
    doll.setScreenPos(s.x, s.y, s.y + 1);
    doll.setDir(summary.dir);
    doll.setAnim('stance');

    const label = this.add
      .text(s.x, s.y - 135, this.formatLabel(summary), {
        fontSize: '12px',
        color: '#bae6fd',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(840000);

    const peer: RemotePeer = {
      summary,
      doll,
      label,
      from: { x: summary.x, y: summary.y },
      to: { x: summary.x, y: summary.y },
      elapsedMs: 0,
      durationMs: STEP_ANIM_SPEED_MS,
      moving: false,
    };
    this.peers.set(summary.id, peer);
    this.updateStatus();

    await this.applyDollPreset(doll, summary.presetId);
  }

  private removePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.doll.destroy();
    peer.label.destroy();
    this.peers.delete(id);
  }

  private movePeer(id: string, x: number, y: number, dir: Dir, steps: 1 | 2): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.from = peer.moving
      ? {
          x: Phaser.Math.Linear(
            peer.from.x,
            peer.to.x,
            Math.min(1, peer.elapsedMs / peer.durationMs),
          ),
          y: Phaser.Math.Linear(
            peer.from.y,
            peer.to.y,
            Math.min(1, peer.elapsedMs / peer.durationMs),
          ),
        }
      : { x: peer.summary.x, y: peer.summary.y };
    peer.to = { x, y };
    peer.summary.x = x;
    peer.summary.y = y;
    peer.summary.dir = dir;
    peer.elapsedMs = 0;
    peer.durationMs = STEP_ANIM_SPEED_MS;
    peer.moving = true;
    peer.doll.setDir(dir);
    peer.doll.setAnim(steps === 2 ? 'run' : 'walk');
  }

  private async applyDollPreset(doll: PaperDoll, presetId: string): Promise<void> {
    const preset = this.manifest.classes[presetId];
    if (!preset) return;
    const entries = Object.entries(preset.layers) as [EquipLayer, string][];
    const loaded = await Promise.all(
      entries.map(async ([slot, file]) => {
        const def = await ensureAnimSetLoaded(this, `avatar/${preset.base}/${file}`);
        return [slot, def] as const;
      }),
    );
    const layers: Partial<Record<EquipLayer, AnimSetDef>> = {};
    for (const [slot, def] of loaded) layers[slot] = def;
    doll.setLayers(layers);
  }

  private beginStep(dir: Dir, requestedSteps: 1 | 2): void {
    if (!this.mapView) return;

    let steps: 1 | 2 = requestedSteps;
    let check = canStep(this.mapView.map.collision, this.actorCell, dir, steps);
    if (!check.ok && steps === 2) {
      steps = 1;
      check = canStep(this.mapView.map.collision, this.actorCell, dir, 1);
    }

    if (!check.ok) {
      this.actor.setDir(dir);
      this.actor.setAnim('stance');
      this.pendingPath = [];
      this.targetGfx.setVisible(false);
      return;
    }

    const seq = ++this.seq;
    this.stepFrom = { ...this.actorCell };
    this.stepTo = check.to;
    this.actorCell = check.to;
    this.stepElapsedMs = 0;
    this.stepDurationMs = steps === 2 ? RUN_STEP_MS : WALK_STEP_MS;
    this.actor.setDir(dir);
    this.actor.setAnim(steps === 2 ? 'run' : 'walk');
    this.bridge.conn.send({ t: 'move', seq, dir, steps });
  }

  private positionSelf(fx: number, fy: number): void {
    const s = cellToScreen(fx, fy);
    this.actor.setScreenPos(s.x, s.y, s.y + 1);
    this.selfLabel.setPosition(s.x, s.y - 135);
    this.cameras.main.centerOn(s.x, s.y - 40);
  }

  private drawTargetMarker(goal: Cell): void {
    const { x: sx, y: sy } = cellToScreen(goal.x, goal.y);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    this.targetGfx.clear();
    this.targetGfx.lineStyle(2, 0x38bdf8, 0.9);
    this.targetGfx.fillStyle(0x38bdf8, 0.18);
    this.targetGfx.beginPath();
    this.targetGfx.moveTo(sx, sy - hh);
    this.targetGfx.lineTo(sx + hw, sy);
    this.targetGfx.lineTo(sx, sy + hh);
    this.targetGfx.lineTo(sx - hw, sy);
    this.targetGfx.closePath();
    this.targetGfx.fillPath();
    this.targetGfx.strokePath();
    this.targetGfx.setVisible(true);
  }

  private wantRun(): boolean {
    return this.runMode || Boolean(this.keys?.shift.isDown);
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

  private formatLabel(summary: PlayerSummary): string {
    const clsName =
      this.manifest.classes[summary.presetId]?.name.split('（')[0] ?? summary.presetId;
    return `${summary.name} · ${clsName}`;
  }

  private updateSelfLabel(): void {
    const clsName = this.manifest.classes[this.presetId]?.name.split('（')[0] ?? this.presetId;
    const tag = this.selfId ? `侠士-${this.selfId.slice(0, 4)}` : '我';
    this.selfLabel.setText(`${tag} · ${clsName}`);
  }

  private setupUi(): void {
    this.uiEl?.remove();
    const root = document.createElement('div');
    root.id = 'world-ui';
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
    title.textContent = '2D 完美世界 (M1 多人格子世界)';
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

    const mkSelect = (): HTMLSelectElement => {
      const sel = document.createElement('select');
      Object.assign(sel.style, {
        width: '175px',
        background: '#1c2030',
        color: '#f3f4f6',
        border: '1px solid #4b5563',
        borderRadius: '4px',
        padding: '2px 4px',
        fontSize: '12px',
      });
      return sel;
    };

    this.presetSelect = mkSelect();
    this.presetSelect.onchange = () => {
      this.bridge?.conn.send({ t: 'setPreset', presetId: this.presetSelect.value });
    };
    row('职业外观', this.presetSelect);

    this.mapSelect = mkSelect();
    this.mapSelect.onchange = () => {
      this.bridge?.conn.send({ t: 'teleport', mapId: this.mapSelect.value });
    };
    row('传送地图', this.mapSelect);

    const runCheck = document.createElement('input');
    runCheck.type = 'checkbox';
    runCheck.checked = this.runMode;
    runCheck.onchange = () => {
      this.runMode = runCheck.checked;
    };
    row('跑步模式 (2格/步)', runCheck);

    const dbgCheck = document.createElement('input');
    dbgCheck.type = 'checkbox';
    dbgCheck.checked = this.debugVisible;
    dbgCheck.onchange = () => {
      this.debugVisible = dbgCheck.checked;
      this.mapView?.setDebugVisible(this.debugVisible);
    };
    row('显示阻挡/传送网格', dbgCheck);

    this.statusEl = document.createElement('div');
    Object.assign(this.statusEl.style, {
      color: '#9ca3af',
      fontSize: '11px',
      borderTop: '1px solid #2b3042',
      paddingTop: '6px',
    });
    root.appendChild(this.statusEl);

    const hint = document.createElement('div');
    hint.textContent = '点击地面寻路 / WASD步进 (Shift跑步) / 走入金色传送点切图';
    hint.style.color = '#6b7280';
    hint.style.fontSize = '11px';
    root.appendChild(hint);

    const viewerBtn = document.createElement('button');
    viewerBtn.textContent = '打开 M0.5 素材预览器';
    Object.assign(viewerBtn.style, {
      background: '#272b3b',
      color: '#d1d5db',
      border: '1px solid #4b5563',
      borderRadius: '4px',
      padding: '4px',
      cursor: 'pointer',
      fontSize: '12px',
    });
    viewerBtn.onclick = () => this.scene.start('Viewer', { returnScene: 'World' });
    root.appendChild(viewerBtn);

    document.body.appendChild(root);
    this.uiEl = root;
    this.populateSelects();
    this.updateStatus();
  }

  private populateSelects(): void {
    if (!this.presetSelect || !this.mapSelect) return;
    this.presetSelect.innerHTML = '';
    for (const [id, c] of Object.entries(this.manifest.classes)) {
      this.presetSelect.add(new Option(c.name, id));
    }
    this.presetSelect.value = this.presetId;

    this.mapSelect.innerHTML = '';
    for (const [id, m] of Object.entries(this.manifest.maps)) {
      this.mapSelect.add(new Option(m.name, id));
    }
    if (this.currentMapId) this.mapSelect.value = this.currentMapId;
  }

  private updateStatus(note?: string): void {
    if (!this.statusEl) return;
    const mapName = this.manifest.maps[this.currentMapId]?.name ?? (this.currentMapId || '连接中');
    const rtt = this.bridge?.conn.rtt ?? 0;
    const aoiCount = 1 + this.peers.size;
    const state = this.bridge?.conn.state === 'connected' ? `RTT ${rtt}ms` : '连接中…';
    const extra = note ? ` | ${note}` : '';
    this.statusEl.textContent = `${mapName} (${this.actorCell.x},${this.actorCell.y}) | 视野 ${aoiCount} 人 | ${state}${extra}`;
  }

  private clearPortalLabels(): void {
    for (const lbl of this.portalLabels) lbl.destroy();
    this.portalLabels = [];
  }

  private cleanup(): void {
    this.uiEl?.remove();
    this.uiEl = null;
    this.clearPortalLabels();
    this.mapView?.destroy();
    this.mapView = null;
    this.targetGfx.destroy();
    this.selfLabel.destroy();
    for (const peer of this.peers.values()) {
      peer.doll.destroy();
      peer.label.destroy();
    }
    this.peers.clear();
  }
}
