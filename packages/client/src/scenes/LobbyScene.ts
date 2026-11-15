import Phaser from 'phaser';
import {
  CLASSES,
  DEFAULT_MANIFEST,
  Dir,
  HAIR_COLORS,
  RACE_NAMES,
  getHeadStylesForBase,
  type AppearanceManifest,
  type CharacterSummary,
  type ClassId,
  type Gender,
  type Race,
  type S2C,
} from '@2dpw/shared';
import { loadJson } from '../render/FlareAssetLoader.ts';
import { PaperDoll, loadPresetToDoll } from '../render/PaperDoll.ts';
import { acquireNetBridge, type NetBridge } from './WorldScene.ts';

export const SESSION_TOKEN_KEY = '2dpw_session_token';

const DIRS_CW: readonly Dir[] = [Dir.S, Dir.SW, Dir.W, Dir.NW, Dir.N, Dir.NE, Dir.E, Dir.SE];

const DIR_NAMES: Readonly<Record<Dir, string>> = {
  [Dir.W]: '西',
  [Dir.NW]: '西北',
  [Dir.N]: '北',
  [Dir.NE]: '东北',
  [Dir.E]: '东',
  [Dir.SE]: '东南',
  [Dir.S]: '南',
  [Dir.SW]: '西南',
};

const CLASS_TAGS: Readonly<Record<ClassId, string>> = {
  blademaster: '近战物理 · 剑/斧',
  wizard: '五行法术 · 远程',
  archer: '长弓射术 · 远程',
  cleric: '治疗增益 · 辅助',
  barbarian: '重装肉盾（男限）',
  venomancer: '毒术召唤（女限）',
};

const RANDOM_NAMES: readonly string[] = [
  '凌霄剑客',
  '素衣仙子',
  '沧澜羽芒',
  '青莲羽灵',
  '玄虎战尊',
  '九尾妖姬',
  '祖龙行者',
  '清风道人',
];

function readStoredToken(): string {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeStoredToken(token: string): void {
  try {
    if (token) localStorage.setItem(SESSION_TOKEN_KEY, token);
    else localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Ignore storage errors in restricted browsing contexts.
  }
}

type LobbyMode = 'auth' | 'select' | 'create';

/**
 * M2 account login/registration, race/class/gender/hair character creator,
 * and character select stage with live 8-direction PaperDoll preview.
 */
export class LobbyScene extends Phaser.Scene {
  private bridge!: NetBridge;
  private manifest: AppearanceManifest = DEFAULT_MANIFEST;

  private doll!: PaperDoll;
  private stageGfx!: Phaser.GameObjects.Graphics;
  private stageTitle!: Phaser.GameObjects.Text;
  private stageSub!: Phaser.GameObjects.Text;

  private uiEl: HTMLDivElement | null = null;
  private mode: LobbyMode = 'auth';
  private username = '';
  private characters: CharacterSummary[] = [];
  private selectedCharId = '';
  private errorMsg = '';
  private statusMsg = '';
  private confirmDeleteId = '';
  private awaitingResume = false;

  // Draft state for character creation
  private draftRace: Race = 'human';
  private draftClass: ClassId = 'blademaster';
  private draftGender: Gender = 'male';
  private draftHead = 'head_short';
  private draftHairColor = 'natural';
  private draftName = '';
  private previewAnim = 'stance';
  private previewDir: Dir = Dir.S;

  constructor() {
    super('Lobby');
  }

  create(): void {
    this.mode = 'auth';
    this.username = '';
    this.characters = [];
    this.selectedCharId = '';
    this.errorMsg = '';
    this.statusMsg = '';
    this.confirmDeleteId = '';
    this.awaitingResume = false;
    this.previewDir = Dir.S;
    this.previewAnim = 'stance';

    this.stageGfx = this.add.graphics().setDepth(1);
    this.doll = new PaperDoll(this, 0, 0);
    this.doll.container.setScale(2.1).setDepth(10);
    this.doll.setDir(this.previewDir);
    this.doll.setAnim(this.previewAnim);

    this.stageTitle = this.add
      .text(0, 0, '', { fontSize: '20px', color: '#f0d890', fontStyle: 'bold' })
      .setOrigin(0.5);
    this.stageSub = this.add.text(0, 0, '', { fontSize: '13px', color: '#9ca3af' }).setOrigin(0.5);

    this.layoutStage();
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    this.renderPanel();
    void this.initLobby();
  }

  override update(_time: number, delta: number): void {
    this.doll.update(delta);
  }

  private onResize(): void {
    if (this.sys.isActive()) this.layoutStage();
  }

  private layoutStage(): void {
    const { width, height } = this.scale;
    const isWide = width >= 760;
    const panelRight = Math.min(410, width * 0.48);
    const sx = isWide ? panelRight + (width - panelRight) * 0.5 : width * 0.5;
    const sy = isWide ? height * 0.56 : Math.max(150, height * 0.23);

    this.doll.setScreenPos(sx, sy, 10);
    this.stageGfx.clear();
    this.stageGfx.fillStyle(0x1f2538, 0.72);
    this.stageGfx.fillEllipse(sx, sy + 12, 190, 68);
    this.stageGfx.lineStyle(2, 0xc9a959, 0.45);
    this.stageGfx.strokeEllipse(sx, sy + 12, 190, 68);

    this.stageTitle.setPosition(sx, sy + 64);
    this.stageSub.setPosition(sx, sy + 90);
  }

  private async initLobby(): Promise<void> {
    this.manifest = await loadJson<AppearanceManifest>('/assets/generated/manifest.json').catch(
      () => DEFAULT_MANIFEST,
    );

    this.bridge = acquireNetBridge(this.game);
    this.bridge.setHandlers(
      (state) => {
        if (state === 'connected') {
          this.tryResumeOrPrompt();
        } else if (state === 'disconnected') {
          this.statusMsg = '连接断开，正在重连…';
          this.renderPanel();
        }
      },
      (msg) => this.handleServerMessage(msg),
    );

    if (this.bridge.conn.state === 'connected') {
      this.tryResumeOrPrompt();
    } else {
      this.statusMsg = '正在连接服务器…';
      this.renderPanel();
    }

    await this.updatePreviewDoll();
  }

  private tryResumeOrPrompt(): void {
    const token = readStoredToken();
    if (token && !this.username) {
      this.awaitingResume = true;
      this.statusMsg = '正在验证登录会话…';
      this.renderPanel();
      this.bridge.conn.send({ t: 'resume', token });
      return;
    }
    this.statusMsg = '已连接服务器';
    this.renderPanel();
  }

  private handleServerMessage(msg: S2C): void {
    switch (msg.t) {
      case 'welcome':
        this.tryResumeOrPrompt();
        return;
      case 'authOk':
        this.awaitingResume = false;
        this.errorMsg = '';
        this.statusMsg = `欢迎回来，${msg.username}`;
        this.username = msg.username;
        writeStoredToken(msg.token);
        this.characters = msg.characters;
        this.selectedCharId = this.characters[0]?.id ?? '';
        this.mode = this.characters.length > 0 ? 'select' : 'create';
        if (this.mode === 'create') this.resetCreateDraft();
        this.renderPanel();
        void this.updatePreviewDoll();
        return;
      case 'authError':
        if (this.awaitingResume) {
          this.awaitingResume = false;
          writeStoredToken('');
          this.statusMsg = '请登录或注册新账号';
        } else {
          this.errorMsg = msg.message;
        }
        this.renderPanel();
        return;
      case 'characterList':
        this.errorMsg = '';
        this.confirmDeleteId = '';
        this.characters = msg.characters;
        if (this.mode === 'create' && this.characters.length > 0) {
          this.selectedCharId = this.characters[this.characters.length - 1]!.id;
          this.mode = 'select';
        } else if (!this.characters.some((c) => c.id === this.selectedCharId)) {
          this.selectedCharId = this.characters[0]?.id ?? '';
        }
        if (this.characters.length === 0) {
          this.mode = 'create';
          this.resetCreateDraft();
        }
        this.renderPanel();
        void this.updatePreviewDoll();
        return;
      case 'joined':
        this.scene.start('World', {
          initialJoined: { self: msg.self, peers: msg.peers },
          activeCharId: msg.self.charId ?? '',
        });
        return;
    }
  }

  private resetCreateDraft(): void {
    this.draftRace = 'human';
    this.draftClass = 'blademaster';
    this.draftGender = 'male';
    this.syncDraftAppearanceDefaults();
    this.draftHairColor = 'natural';
    if (!this.draftName) {
      this.draftName = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]!;
    }
  }

  private syncDraftAppearanceDefaults(): void {
    const cls = CLASSES[this.draftClass];
    if (!cls.genders.includes(this.draftGender)) {
      this.draftGender = cls.genders[0]!;
    }
    const presetId = `${this.draftClass}.${this.draftGender}`;
    const preset = this.manifest.classes[presetId];
    if (!preset) return;
    const validHeads = getHeadStylesForBase(preset.base);
    if (!validHeads.some((h) => h.id === this.draftHead)) {
      this.draftHead = preset.layers.head ?? validHeads[0]?.id ?? 'head_short';
    }
  }

  private async updatePreviewDoll(): Promise<void> {
    this.doll.setDir(this.previewDir);
    this.doll.setAnim(this.previewAnim);

    if (this.mode === 'select' && this.selectedCharId) {
      const char = this.characters.find((c) => c.id === this.selectedCharId);
      if (char) {
        this.stageTitle.setText(`${char.name}  Lv.${char.level}`);
        const clsName = CLASSES[char.classId]?.name ?? char.classId;
        const mapName = this.manifest.maps[char.mapId]?.name ?? char.mapId;
        this.stageSub.setText(
          `${RACE_NAMES[char.race]} · ${clsName} · ${char.gender === 'male' ? '男' : '女'} | ${mapName} (${DIR_NAMES[this.previewDir]})`,
        );
        await loadPresetToDoll(
          this,
          this.manifest,
          this.doll,
          char.presetId,
          char.headStyle,
          char.hairColor,
        );
        return;
      }
    }

    if (this.mode === 'create') {
      const presetId = `${this.draftClass}.${this.draftGender}`;
      const cls = CLASSES[this.draftClass];
      const colorName = HAIR_COLORS.find((c) => c.id === this.draftHairColor)?.name ?? '原色';
      this.stageTitle.setText(this.draftName.trim() || '新建角色预览');
      this.stageSub.setText(
        `${RACE_NAMES[this.draftRace]} · ${cls.name} · ${this.draftGender === 'male' ? '男' : '女'} | ${colorName} (${DIR_NAMES[this.previewDir]})`,
      );
      await loadPresetToDoll(
        this,
        this.manifest,
        this.doll,
        presetId,
        this.draftHead,
        this.draftHairColor,
      );
      return;
    }

    this.stageTitle.setText('2D 完美世界');
    this.stageSub.setText(`三族六职业 · ${DIR_NAMES[this.previewDir]}`);
    await loadPresetToDoll(this, this.manifest, this.doll, 'blademaster.male');
  }

  private rotatePreview(step: number): void {
    const idx = DIRS_CW.indexOf(this.previewDir);
    const nextIdx = (idx + step + DIRS_CW.length) % DIRS_CW.length;
    this.previewDir = DIRS_CW[nextIdx]!;
    void this.updatePreviewDoll();
  }

  private renderPanel(): void {
    if (!this.uiEl) {
      const root = document.createElement('div');
      root.id = 'lobby-ui';
      Object.assign(root.style, {
        position: 'fixed',
        top: '14px',
        left: '14px',
        zIndex: '120',
        width: 'min(380px, calc(100vw - 28px))',
        maxHeight: 'calc(100vh - 28px)',
        overflowY: 'auto',
        background: 'rgba(13, 16, 25, 0.92)',
        border: '1px solid #4d432c',
        borderRadius: '10px',
        padding: '14px 16px',
        color: '#e5e7eb',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        boxShadow: '0 10px 32px rgba(0,0,0,0.6)',
      });
      root.addEventListener('pointerdown', (e) => e.stopPropagation());
      document.body.appendChild(root);
      this.uiEl = root;
    }

    const root = this.uiEl;
    root.innerHTML = '';

    const header = document.createElement('div');
    header.textContent = '2D 完美世界 · 角色大厅 (M2)';
    Object.assign(header.style, { fontSize: '16px', fontWeight: '700', color: '#f0d890' });
    root.appendChild(header);

    if (this.statusMsg) {
      const st = document.createElement('div');
      st.textContent = this.statusMsg;
      Object.assign(st.style, { fontSize: '12px', color: '#9ca3af' });
      root.appendChild(st);
    }

    if (this.errorMsg) {
      const err = document.createElement('div');
      err.textContent = this.errorMsg;
      Object.assign(err.style, {
        fontSize: '12px',
        color: '#fca5a5',
        background: 'rgba(127, 29, 29, 0.45)',
        border: '1px solid #ef4444',
        borderRadius: '6px',
        padding: '6px 8px',
      });
      root.appendChild(err);
    }

    if (this.mode === 'auth') this.renderAuthForm(root);
    else if (this.mode === 'select') this.renderSelectView(root);
    else this.renderCreateView(root);

    this.renderStageControls(root);
  }

  private renderAuthForm(root: HTMLDivElement): void {
    const userInput = this.mkInput('账号 (3~18位字母/数字/中文)', 'text');
    const passInput = this.mkInput('密码 (至少4位)', 'password');

    const submitAuth = (type: 'login' | 'register'): void => {
      this.errorMsg = '';
      if (this.bridge.conn.state !== 'connected') {
        this.errorMsg = '尚未连接服务器，请稍候';
        this.renderPanel();
        return;
      }
      this.bridge.conn.send({
        t: type,
        username: userInput.value,
        password: passInput.value,
      });
    };

    passInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitAuth('login');
    });

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px' });
    row.append(
      this.mkButton('登录账号', () => submitAuth('login'), true),
      this.mkButton('注册并登录', () => submitAuth('register')),
    );

    const guestBtn = this.mkButton('游客快速进入（不保存存档）', () => {
      this.scene.start('World');
    });
    guestBtn.style.marginTop = '4px';

    root.append(userInput, passInput, row, guestBtn);
  }

  private renderSelectView(root: HTMLDivElement): void {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottom: '1px solid #2b3042',
      paddingBottom: '6px',
    });
    const who = document.createElement('span');
    who.textContent = `当前账号：${this.username}`;
    who.style.color = '#cbd5e1';
    const logoutBtn = this.mkButton('退出登录', () => {
      writeStoredToken('');
      this.username = '';
      this.characters = [];
      this.selectedCharId = '';
      this.mode = 'auth';
      this.statusMsg = '已退出登录';
      this.bridge.conn.send({ t: 'logout' });
      this.renderPanel();
      void this.updatePreviewDoll();
    });
    logoutBtn.style.padding = '3px 8px';
    logoutBtn.style.fontSize = '11px';
    bar.append(who, logoutBtn);
    root.appendChild(bar);

    const list = document.createElement('div');
    Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '6px' });

    for (const c of this.characters) {
      const selected = c.id === this.selectedCharId;
      const card = document.createElement('div');
      Object.assign(card.style, {
        padding: '8px 10px',
        borderRadius: '6px',
        cursor: 'pointer',
        border: selected ? '1px solid #f0d890' : '1px solid #2e3448',
        background: selected ? 'rgba(240, 216, 144, 0.14)' : 'rgba(24, 28, 42, 0.8)',
      });
      card.onclick = () => {
        this.selectedCharId = c.id;
        this.confirmDeleteId = '';
        this.renderPanel();
        void this.updatePreviewDoll();
      };

      const top = document.createElement('div');
      Object.assign(top.style, {
        display: 'flex',
        justifyContent: 'space-between',
        fontWeight: '600',
        color: selected ? '#fef08a' : '#f3f4f6',
      });
      top.textContent = `${c.name} (Lv.${c.level})`;

      const sub = document.createElement('div');
      const clsName = CLASSES[c.classId]?.name ?? c.classId;
      const mapName = this.manifest.maps[c.mapId]?.name ?? c.mapId;
      const bagTotal = c.bag.reduce((sum, it) => sum + it.count, 0);
      sub.textContent = `${RACE_NAMES[c.race]} · ${clsName} · ${c.gender === 'male' ? '男' : '女'} | ${mapName} (${c.x},${c.y}) | 背包 ${bagTotal}件`;
      Object.assign(sub.style, { fontSize: '11px', color: '#9ca3af', marginTop: '3px' });

      card.append(top, sub);
      list.appendChild(card);
    }
    root.appendChild(list);

    const enterBtn = this.mkButton(
      '进入完美大陆',
      () => {
        if (!this.selectedCharId) return;
        this.bridge.conn.send({ t: 'enterWorld', charId: this.selectedCharId });
      },
      true,
    );

    const ops = document.createElement('div');
    Object.assign(ops.style, { display: 'flex', gap: '8px' });
    const createBtn = this.mkButton('+ 创建新角色', () => {
      this.mode = 'create';
      this.confirmDeleteId = '';
      this.errorMsg = '';
      this.resetCreateDraft();
      this.renderPanel();
      void this.updatePreviewDoll();
    });
    const isConfirming =
      this.confirmDeleteId === this.selectedCharId && Boolean(this.selectedCharId);
    const delBtn = this.mkButton(isConfirming ? '再次点击确认删除' : '删除角色', () => {
      if (!this.selectedCharId) return;
      if (this.confirmDeleteId !== this.selectedCharId) {
        this.confirmDeleteId = this.selectedCharId;
        this.renderPanel();
        return;
      }
      this.bridge.conn.send({ t: 'deleteCharacter', charId: this.selectedCharId });
      this.confirmDeleteId = '';
    });
    if (isConfirming) {
      delBtn.style.borderColor = '#ef4444';
      delBtn.style.color = '#fca5a5';
    }
    ops.append(createBtn, delBtn);

    root.append(enterBtn, ops);
  }

  private renderCreateView(root: HTMLDivElement): void {
    // 1. Race picker
    root.appendChild(this.mkLabel('1. 选择种族'));
    const raceRow = document.createElement('div');
    Object.assign(raceRow.style, { display: 'flex', gap: '6px' });
    for (const race of ['human', 'elf', 'untamed'] as const) {
      const btn = this.mkButton(
        RACE_NAMES[race],
        () => {
          this.draftRace = race;
          const firstCls = Object.values(CLASSES).find((c) => c.race === race)!;
          this.draftClass = firstCls.id;
          this.syncDraftAppearanceDefaults();
          this.renderPanel();
          void this.updatePreviewDoll();
        },
        this.draftRace === race,
      );
      btn.style.flex = '1';
      raceRow.appendChild(btn);
    }
    root.appendChild(raceRow);

    // 2. Class picker for active race
    root.appendChild(this.mkLabel('2. 选择职业'));
    const clsRow = document.createElement('div');
    Object.assign(clsRow.style, { display: 'flex', flexDirection: 'column', gap: '5px' });
    for (const cls of Object.values(CLASSES).filter((c) => c.race === this.draftRace)) {
      const btn = this.mkButton(
        `${cls.name} — ${CLASS_TAGS[cls.id]}`,
        () => {
          this.draftClass = cls.id;
          this.syncDraftAppearanceDefaults();
          this.renderPanel();
          void this.updatePreviewDoll();
        },
        this.draftClass === cls.id,
      );
      btn.style.textAlign = 'left';
      clsRow.appendChild(btn);
    }
    root.appendChild(clsRow);

    // 3. Gender picker (enforcing PWI class locks)
    const allowedGenders = CLASSES[this.draftClass].genders;
    root.appendChild(this.mkLabel('3. 选择性别'));
    const genderRow = document.createElement('div');
    Object.assign(genderRow.style, { display: 'flex', gap: '6px' });
    for (const g of ['male', 'female'] as const) {
      const allowed = allowedGenders.includes(g);
      const label = allowed
        ? g === 'male'
          ? '男'
          : '女'
        : `${g === 'male' ? '男' : '女'} (不可选)`;
      const btn = this.mkButton(
        label,
        () => {
          if (!allowed) return;
          this.draftGender = g;
          this.syncDraftAppearanceDefaults();
          this.renderPanel();
          void this.updatePreviewDoll();
        },
        this.draftGender === g,
      );
      btn.style.flex = '1';
      if (!allowed) {
        btn.disabled = true;
        btn.style.opacity = '0.42';
        btn.style.cursor = 'not-allowed';
      }
      genderRow.appendChild(btn);
    }
    root.appendChild(genderRow);

    // 4. Head / hair style
    const presetId = `${this.draftClass}.${this.draftGender}`;
    const preset = this.manifest.classes[presetId];
    const headOptions = preset ? getHeadStylesForBase(preset.base) : [];
    root.appendChild(this.mkLabel('4. 发型 / 头饰'));
    const headSel = document.createElement('select');
    Object.assign(headSel.style, {
      background: '#1c2030',
      color: '#f3f4f6',
      border: '1px solid #4b5563',
      borderRadius: '6px',
      padding: '5px 8px',
      fontSize: '12px',
    });
    for (const opt of headOptions) {
      headSel.add(new Option(opt.name, opt.id));
    }
    headSel.value = this.draftHead;
    headSel.onchange = () => {
      this.draftHead = headSel.value;
      void this.updatePreviewDoll();
    };
    root.appendChild(headSel);

    // 5. Hair / head color tint
    root.appendChild(this.mkLabel('5. 发色染色'));
    const colorRow = document.createElement('div');
    Object.assign(colorRow.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
    for (const col of HAIR_COLORS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = col.name;
      const active = this.draftHairColor === col.id;
      Object.assign(chip.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        borderRadius: '999px',
        cursor: 'pointer',
        fontSize: '11px',
        background: active ? '#2d354d' : '#1b2030',
        color: active ? '#fef08a' : '#d1d5db',
        border: active ? '1px solid #f0d890' : '1px solid #3f475e',
      });
      const dot = document.createElement('span');
      Object.assign(dot.style, {
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        background: col.hex,
        border: '1px solid rgba(255,255,255,0.4)',
      });
      chip.prepend(dot);
      chip.onclick = () => {
        this.draftHairColor = col.id;
        this.renderPanel();
        void this.updatePreviewDoll();
      };
      colorRow.appendChild(chip);
    }
    root.appendChild(colorRow);

    // 6. Character name
    root.appendChild(this.mkLabel('6. 角色名称'));
    const nameRow = document.createElement('div');
    Object.assign(nameRow.style, { display: 'flex', gap: '6px' });
    const nameInput = this.mkInput('角色名 (2~12位)', 'text');
    nameInput.value = this.draftName;
    nameInput.style.flex = '1';
    nameInput.oninput = () => {
      this.draftName = nameInput.value;
      void this.updatePreviewDoll();
    };
    const rndBtn = this.mkButton('随机', () => {
      this.draftName =
        RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]! +
        Math.floor(10 + Math.random() * 89);
      this.renderPanel();
      void this.updatePreviewDoll();
    });
    nameRow.append(nameInput, rndBtn);
    root.appendChild(nameRow);

    // Submit & back
    const confirmBtn = this.mkButton(
      '确认创建角色',
      () => {
        this.errorMsg = '';
        this.bridge.conn.send({
          t: 'createCharacter',
          name: this.draftName,
          classId: this.draftClass,
          gender: this.draftGender,
          headStyle: this.draftHead,
          hairColor: this.draftHairColor,
        });
      },
      true,
    );
    root.appendChild(confirmBtn);

    if (this.characters.length > 0) {
      root.appendChild(
        this.mkButton('返回角色列表', () => {
          this.mode = 'select';
          this.errorMsg = '';
          this.renderPanel();
          void this.updatePreviewDoll();
        }),
      );
    }
  }

  private renderStageControls(root: HTMLDivElement): void {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '5px',
      borderTop: '1px solid #2b3042',
      paddingTop: '8px',
      marginTop: '2px',
    });

    const rotL = this.mkButton('↺ 左转', () => this.rotatePreview(-1));
    const rotR = this.mkButton('↻ 右转', () => this.rotatePreview(1));
    rotL.style.padding = '3px 7px';
    rotR.style.padding = '3px 7px';
    bar.append(rotL, rotR);

    for (const [anim, label] of [
      ['stance', '站立'],
      ['run', '奔跑'],
      ['swing', '近战'],
      ['cast', '施法'],
      ['shoot', '射击'],
    ] as const) {
      const btn = this.mkButton(
        label,
        () => {
          this.previewAnim = anim;
          this.renderPanel();
          void this.updatePreviewDoll();
        },
        this.previewAnim === anim,
      );
      btn.style.padding = '3px 7px';
      btn.style.fontSize = '11px';
      bar.appendChild(btn);
    }
    root.appendChild(bar);
  }

  private mkLabel(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, { fontSize: '12px', color: '#9ca3af', fontWeight: '600' });
    return el;
  }

  private mkInput(placeholder: string, type: 'text' | 'password'): HTMLInputElement {
    const input = document.createElement('input');
    input.type = type;
    input.placeholder = placeholder;
    Object.assign(input.style, {
      background: '#171b28',
      color: '#f9fafb',
      border: '1px solid #3f475e',
      borderRadius: '6px',
      padding: '7px 9px',
      fontSize: '13px',
      outline: 'none',
    });
    return input;
  }

  private mkButton(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    Object.assign(btn.style, {
      background: primary ? 'linear-gradient(180deg, #5e4b22, #3e3114)' : '#1e2436',
      color: primary ? '#fef08a' : '#e5e7eb',
      border: primary ? '1px solid #c9a959' : '1px solid #414961',
      borderRadius: '6px',
      padding: '6px 10px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: primary ? '600' : '500',
    });
    btn.onclick = onClick;
    return btn;
  }

  private cleanup(): void {
    this.scale.off('resize', this.onResize, this);
    this.uiEl?.remove();
    this.uiEl = null;
    this.doll?.destroy();
    this.stageGfx?.destroy();
    this.stageTitle?.destroy();
    this.stageSub?.destroy();
  }
}
