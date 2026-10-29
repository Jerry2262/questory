# Questory

> A personal quest log for real life.
> 把每周的任务，写成自己的故事。

Questory 是一个本地优先的个人任务日志：按周组织、四象限展开、支持子任务层级，所有内容直接在页面上编辑，数据只存在本机。

## 它是什么

- **按周**：当前周的事项一屏摊开，历史周向下连续滚动。
- **任务树**：四象限承载分类，子任务承载层级，父任务状态由子任务自动推导。
- **自动继承**：新的一周从最近一个填过的周继承任务树，不需要手动复制。
- **本地优先**：一个本地 Web 进程，数据只有一个 JSON 文件，不依赖云服务。

当前是 0.x 早期版本，设计范围内的能力尚未全部完成；设计意图、规则和后续方向见 [DESIGN.md](DESIGN.md)。

## 环境要求

- Node.js 22.12 或更新版本
- 现代浏览器

## 运行

```bash
npm install
npm run dev
```

启动后打开终端提示的本地地址。首次运行会在 `data/` 下创建空数据文件。

生产模式：

```bash
npm run build
npm start
```

## 数据与恢复

- 唯一数据文件：`data/quests.json`，不进 git。
- 服务启动和每天首次写盘前自动备份到 `data/backups/`。
- 恢复：停掉服务，把目标备份复制回 `data/quests.json`，再重启。
- 备份是唯一的恢复路径；数据结构与备份规则见 [DESIGN.md](DESIGN.md) §5。

## 使用

打开后直接编辑任务标题和备注；新建、缩进、勾选、撤销、周跳转都在页面内。交互细节以界面为准。

## 开发

```bash
npm test
npm run test:e2e
npm run build
```

代码结构与实现细节以源码为准；协作规则见 [AGENTS.md](AGENTS.md)。

## 文档

- [DESIGN.md](DESIGN.md)：定位、规则、不变量、边界与设计决策
- [AGENTS.md](AGENTS.md)：协作硬规则

## License

[MIT](LICENSE)。
