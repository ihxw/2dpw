import Phaser from 'phaser';
import { CLASSES, RACE_NAMES } from '@2dpw/shared';
import { Connection, type ConnState } from '../net/Connection.ts';

const STATE_TEXT: Record<ConnState, string> = {
  connecting: '正在连接服务器…',
  connected: '已连接服务器',
  disconnected: '与服务器断开，重连中…',
};

export class BootScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private rttText!: Phaser.GameObjects.Text;
  private conn!: Connection;

  constructor() {
    super('Boot');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2 - 80, '2D 完美世界', { fontSize: '40px', color: '#f0d890' })
      .setOrigin(0.5);

    const classes = Object.values(CLASSES)
      .map((c) => `${RACE_NAMES[c.race]}·${c.name}`)
      .join('   ');
    this.add
      .text(width / 2, height / 2 - 30, classes, { fontSize: '14px', color: '#9aa' })
      .setOrigin(0.5);

    this.status = this.add
      .text(width / 2, height / 2 + 20, '', { fontSize: '20px', color: '#ccc' })
      .setOrigin(0.5);
    this.rttText = this.add
      .text(width / 2, height / 2 + 50, '', { fontSize: '14px', color: '#888' })
      .setOrigin(0.5);

    this.conn = new Connection((s) => {
      this.status.setText(STATE_TEXT[s]);
      this.status.setColor(s === 'connected' ? '#7f7' : s === 'connecting' ? '#ccc' : '#f77');
    });
    this.conn.connect();
  }

  override update(): void {
    if (this.conn.state === 'connected') this.rttText.setText(`延迟 ${this.conn.rtt} ms`);
  }
}
