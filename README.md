# 2D 完美世界

个人测试项目：玩法和数值按《完美世界国际版》1.3.6（三族六职业）来做，画面是 2.5D 等距斜视角，按格子移动（操作手感参考传奇世界），美术用开源的 Flare 素材（CC-BY-SA 3.0）。

完整计划见 [docs/PLAN.md](docs/PLAN.md)。

## 快速开始

```bash
npm install
bash tools/fetch-assets.sh   # 拉取 Flare 开源美术到 assets/vendor/（约 780MB，不进 Git）
npm run dev                  # 同时启动 服务端 :7788 和 客户端 :5173
```

浏览器打开 http://localhost:5173 ，看到"已连接服务器"就说明跑通了。

## 常用命令

| 命令                | 作用                            |
| ------------------- | ------------------------------- |
| `npm run dev`       | 开发模式（服务端热重载 + Vite） |
| `npm test`          | 单元测试（Vitest）              |
| `npm run typecheck` | 全部包类型检查                  |
| `npm run lint`      | ESLint 代码检查                 |

## 目录

```
packages/shared   前后端共享：协议、网格/方向、种族职业定义、公式
packages/server   Node + ws 服务端（服务端说了算）
packages/client   Phaser 3 + Vite 客户端
tools/            素材拉取与转换工具
assets/           CREDITS.md；vendor/ 和 generated/ 不进 Git
docs/             计划与设计文档
```
