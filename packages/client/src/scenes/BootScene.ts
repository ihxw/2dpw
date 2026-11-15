import Phaser from 'phaser';
import { CLASSES, RACE_NAMES, type S2C } from '@2dpw/shared';
import { Connection, type ConnState } from '../net/Connection.ts';
import type { NetBridge } from './WorldScene.ts';

const STATE_TEXT: Record<ConnState, string> = {
  connecting: '正在连接服务器…',
  connected: '已连接服务器',
  disconnected: '与服务器断开，重连中…',
};

export class BootScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private rttText!: Phaser.GameObjects.Text;
  private bridge!: NetBridge;
  private enterTimer: number | undefined;

  constructor() {
    super('Boot');
  }

  create(): void {
    const sceneParam = new URLSearchParams(location.search).get('scene');
    if (sceneParam === 'viewer') {
      this.scene.start('Viewer');
      return;
    }

    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2 - 90, '2D 完美世界', { fontSize: '40px', color: '#f0d890' })
      .setOrigin(0.5);

    const classes = Object.values(CLASSES)
      .map((c) => `${RACE_NAMES[c.race]}·${c.name}`)
      .join('   ');
    this.add
      .text(width / 2, height / 2 - 40, classes, { fontSize: '14px', color: '#9aa' })
      .setOrigin(0.5);

    this.status = this.add
      .text(width / 2, height / 2 + 10, '', { fontSize: '20px', color: '#ccc' })
      .setOrigin(0.5);
    this.rttText = this.add
      .text(width / 2, height / 2 + 40, '', { fontSize: '14px', color: '#888' })
      .setOrigin(0.5);

    const makeBtn = (y: number, label: string, onClick: () => void): Phaser.GameObjects.Text => {
      const btn = this.add
        .text(width / 2, y, label, {
          fontSize: '16px',
          color: '#f0d890',
          backgroundColor: '#1f2538',
          padding: { x: 14, y: 8 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#2e3754' }));
      btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#1f2538' }));
      btn.on('pointerdown', onClick);
      return btn;
    };

    makeBtn(height / 2 + 95, '[ 进入游戏世界 (M1) ]', () => {
      window.clearTimeout(this.enterTimer);
      this.scene.start('World');
    });

    makeBtn(height / 2 + 145, '[ 进入 M0.5 素材与地图预览器 ]', () => {
      window.clearTimeout(this.enterTimer);
      this.scene.start('Viewer');
    });

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

    const applyState = (s: ConnState): void => {
      if (!this.sys.isActive()) return;
      this.status.setText(STATE_TEXT[s]);
      this.status.setColor(s === 'connected' ? '#7f7' : s === 'connecting' ? '#ccc' : '#f77');
      if (s === 'connected' && sceneParam !== 'boot' && this.enterTimer === undefined) {
        this.enterTimer = window.setTimeout(() => {
          if (this.sys.isActive()) this.scene.start('World');
        }, 400);
      }
    };

    this.bridge.setHandlers(applyState, () => {});
    applyState(this.bridge.conn.state);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.clearTimeout(this.enterTimer);
      this.enterTimer = undefined;
    });
  }

  override update(): void {
    if (this.bridge?.conn.state === 'connected') {
      this.rttText.setText(`延迟 ${this.bridge.conn.rtt} ms`);
    }
  }
}
