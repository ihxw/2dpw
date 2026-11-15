import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.ts';
import { ViewerScene } from './scenes/ViewerScene.ts';
import { WorldScene } from './scenes/WorldScene.ts';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b0b10',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [BootScene, WorldScene, ViewerScene],
});
