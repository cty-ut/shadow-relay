# 影子接力

格子地图、回合制的解谜游戏。你可以把「这一轮的自己」录下来，时间回到开头后，它变成一个影子，一步不差地重复你刚才按过的键。你要和过去的自己配合（踩压力板、开门、推箱子、让路），让**现在的你**走到终点。

- 5 章 50 关，机制分层引入，难度锯齿形上升
- 核心机制「按键 ≠ 轨迹」：影子重复的是你按过的键，不是你走过的路——上一轮撞墙的按键，这一轮门开了它就真的会走过去
- 每关的最少步数都由求解器验证过（`node tools/solve.mjs`）

## 在线玩

**https://cty-ut.github.io/shadow-relay/**

手机竖屏优先，桌面浏览器也可以。

## 本地运行

纯静态文件，不需要构建：

```bash
cd 游戏
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

（ES Module 限制，直接双击 index.html 打不开，需要走 http。）

## 测试

```bash
npm install   # 只为装 jsdom（UI 集成测试用）
npm test      # node --test：引擎规则 + 求解器 + UI 集成，共 27 项
```

## 操作

- 手机：地图上滑动移动（按住拖动可连续走），下方按钮：等待 / 回溯 / 撤销 / 重开 / 提示
- 桌面：方向键或 WASD 移动，空格等待，`R` 回溯，`Z` 撤销，`Backspace` 重开
- 点击压力板，高亮同通道的所有门

## 目录结构

```
index.html
style.css
src/engine.js     规则引擎（纯逻辑，Node 可直接复用，游戏和求解器共用）
src/solver.js     求解器（最少影子数/最少步数/解数/是否必须盲按）
src/levels.js     50 关数据（含求解器验证过的 par 最少步数）
src/render.js     画面与反馈
src/input.js      键盘 / 滑动 / 按钮
src/audio.js      Web Audio 代码合成音效和背景音乐
src/main.js       控制器
src/telemetry.js  试玩数据记录（localStorage，选关页可导出 JSON）
tools/solve.mjs   关卡分析工具
test/             node --test 测试
```

## 文档

- [需求文档.md](需求文档.md) —— 规则、界面、关卡的设计文档
- [迭代记录.md](迭代记录.md) —— 每一轮试玩的观察、结论与改动（提交用的迭代优化过程文档）

## 部署

静态文件直接部署即可（GitHub Pages / Netlify / Vercel）。资源路径均为相对路径，部署在子路径下也能正常打开。
