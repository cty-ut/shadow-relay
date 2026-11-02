// src/main.js —— 控制器：串起引擎、画面、输入、数据记录

import { LEVELS, CHAPTERS, solutionActions } from './levels.js';
import { Game } from './engine.js';
import { GameView } from './render.js';
import { initInput } from './input.js';
import * as telemetry from './telemetry.js';

const $ = (sel) => document.querySelector(sel);
const debugMode = new URLSearchParams(location.search).has('debug');

const selectScreen = $('#select-screen');
const gameScreen = $('#game-screen');

let game = null;
let view = null;
let levelIndex = -1;
let demo = null;   // 自动演示：{ game, timer }
let guide = null;  // 新手引导：{ type, phase, onPlate, bumps }

function show(screen) {
  selectScreen.classList.toggle('active', screen === selectScreen);
  gameScreen.classList.toggle('active', screen === gameScreen);
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---- 选关 ----

function buildSelect() {
  const list = $('#level-list');
  list.innerHTML = '';
  let grid = null;
  let chapter = null;
  LEVELS.forEach((lv, i) => {
    if (lv.chapter !== chapter) {
      chapter = lv.chapter;
      const title = document.createElement('div');
      title.className = 'chapter-title';
      title.textContent = `第 ${chapter} 章 · ${CHAPTERS[chapter]}`;
      grid = document.createElement('div');
      grid.className = 'chapter-grid';
      list.append(title, grid);
    }
    const cleared = telemetry.isCleared(lv.id);
    const card = document.createElement('button');
    card.className = 'level-card' + (cleared ? ' cleared' : '');
    card.title = lv.name;
    card.innerHTML = `<span class="lv-num">${lv.id}</span><span class="lv-name">${lv.name}</span>`;
    card.addEventListener('click', () => enterLevel(i));
    grid.appendChild(card);
  });
  $('#record-count').textContent = `已记录 ${telemetry.getRecords().length} 条试玩数据`;
}

function enterLevel(i) {
  stopDemo({ silent: true });
  if (view) view.destroy();
  closeOverlays();
  levelIndex = i;
  game = new Game(LEVELS[i]);
  show(gameScreen);
  view = new GameView(gameScreen, game);
  telemetry.startLevel(LEVELS[i].id);
  initGuide();
  if (debugMode) syncDebug();
}

function leaveLevel() {
  stopDemo({ silent: true });
  if (game && telemetry.hasActive() && !game.won) {
    telemetry.endLevel(false, { t: game.t, round: game.round });
  }
  if (view) view.destroy();
  view = null;
  game = null;
  closeOverlays();
  buildSelect();
  show(selectScreen);
}

function closeOverlays() {
  $('#fx-win').classList.remove('show');
  $('#fx-rewind').classList.remove('play');
}

// ---- 操作 ----

function doMove(dir) {
  if (demo) { stopDemo(); return; }
  if (!game || !game.canMove) return;
  const from = { ...game.player };
  const res = game.step(dir);
  if (!res.ok) return;
  telemetry.markInput();
  telemetry.countMove();
  view.onStep(res, game);
  guideAfterStep(from, dir, res);
  if (debugMode) syncDebug();
  if (res.won) onWin();
}

function doWait() { doMove('W'); }

function doRewind() {
  if (demo) { stopDemo(); return; }
  if (!game || !game.canRewind) return;
  const res = game.rewind();
  if (!res.ok) return;
  telemetry.markInput();
  telemetry.countRewind();
  view.onRewind(res, game);
  guideAfterRewind();
  if (debugMode) syncDebug();
}

function doUndo() {
  if (demo) { stopDemo(); return; }
  if (!game || !game.canUndo) return;
  const res = game.undo();
  if (!res.ok) return;
  telemetry.markInput();
  telemetry.countUndo();
  view.sync(game);
  if (debugMode) syncDebug();
}

function doRestart() {
  if (demo) { stopDemo(); return; }
  if (!game) return;
  telemetry.markInput();
  telemetry.countRestart();
  game.restart();
  view.sync(game, { snap: true });
  initGuide();
  if (debugMode) syncDebug();
}

// 提示分三级：提示 1 → 提示 2 → 自动演示解法（5.3）
function doHint() {
  if (demo) { stopDemo(); return; }
  if (!view || game.won) return;
  const level = Math.min(view.hintLevel + 1, 3);
  telemetry.markHint(level);
  if (level < 3) view.setHintLevel(level);
  else startDemo();
}

// ---- 自动演示：在一局独立的游戏上播放 solution，结束后回到本关开头 ----

function startDemo() {
  const def = LEVELS[levelIndex];
  const dg = new Game(def);
  const actions = solutionActions(def.solution);
  let i = 0;
  demo = { game: dg, timer: null };
  view.hideGuide();
  view.sync(dg, { snap: true });
  view.setDemo(true);
  const next = () => {
    if (!demo) return;
    if (i >= actions.length) {
      demo.timer = setTimeout(() => stopDemo(), 900);
      return;
    }
    const a = actions[i++];
    if (a === 'rewind') {
      view.onRewind(dg.rewind(), dg);
      demo.timer = setTimeout(next, 1100);
    } else {
      view.onStep(dg.step(a), dg);
      demo.timer = setTimeout(next, 300);
    }
  };
  demo.timer = setTimeout(next, 500);
}

function stopDemo({ silent = false } = {}) {
  if (!demo) return;
  clearTimeout(demo.timer);
  demo = null;
  if (silent || !view) return;
  game.restart();
  view.setDemo(false);
  view.sync(game, { snap: true });
  if (debugMode) syncDebug();
}

// ---- 新手引导（5.6）：只在没通关过的关卡出现，卡住时才提示 ----

function initGuide() {
  guide = null;
  if (view) view.hideGuide();
  const def = LEVELS[levelIndex];
  if (!def.guide || telemetry.isCleared(def.id)) return;
  guide = { type: def.guide, phase: 'wait', onPlate: 0, bumps: 0 };
  if (guide.type === 'move') view.showGuide('滑动屏幕（电脑上用方向键）移动，走到终点');
}

function guideAfterStep(from, dir, res) {
  if (!guide) return;
  if (res.won) { view.hideGuide(); guide = null; return; }
  if (guide.type === 'move') {
    if (guide.phase === 'wait') { view.hideGuide(); guide.phase = 'done'; }
    return;
  }
  if (guide.type !== 'firstRewind' || guide.phase !== 'wait') return;
  const onPlate = game.level.plates.some((p) => p.x === game.player.x && p.y === game.player.y);
  if (onPlate) guide.onPlate++;
  if (res.failed.some((f) => f.isPlayer)) {
    const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[dir];
    if (d && game.cellAt(from.x + d[0], from.y + d[1]) === 'door') guide.bumps++;
  }
  if (guide.onPlate >= 2 || guide.bumps >= 2 || !game.canMove) {
    guide.phase = 'shown';
    view.showGuide('按「回溯」：这一轮的你会留下来帮下一轮的你', { pulse: 'rewind' });
  }
}

function guideAfterRewind() {
  if (!guide || guide.type !== 'firstRewind' || guide.phase === 'after') return;
  guide.phase = 'after';
  view.showGuide('影子会重复你刚才的动作。现在去门那里。');
}

function onWin() {
  if (guide) { view.hideGuide(); guide = null; }
  telemetry.endLevel(true);
  telemetry.markCleared(LEVELS[levelIndex].id);
  view.winFx({
    shadows: game.shadowCount,
    steps: game.totalSteps,
    hasNext: levelIndex < LEVELS.length - 1,
    onNext: () => enterLevel(levelIndex + 1),
    onReplay: () => enterLevel(levelIndex),
    onSelect: () => leaveLevel(),
  });
  if (debugMode) syncDebug();
}

// ---- 导出 / 调试 ----

async function onExport() {
  telemetry.downloadExport();
  const ok = await telemetry.copyExport();
  toast(ok ? '试玩数据已下载并复制到剪贴板' : '试玩数据已下载（复制失败）');
}

function syncDebug() {
  if (!game) return;
  const doors = [...game.doorStates(game.allPositions()).entries()];
  $('#debug-state').textContent = JSON.stringify({
    t: game.t,
    round: game.round,
    player: [game.player.x, game.player.y],
    script: game.script.join(''),
    shadows: game.shadows.map((s, i) => ({
      n: i + 1,
      script: s.script.join(''),
      pos: [s.pos.x, s.pos.y],
    })),
    doors,
  });
}

function initDebug() {
  $('#debug-panel').classList.add('show');
  $('#debug-clear').addEventListener('click', () => {
    telemetry.clearAll();
    buildSelect();
    syncDebug();
    toast('试玩数据已清空');
  });
}

// ---- 启动 ----

buildSelect();
show(selectScreen);
// ?level=N 直接进入第 N 关（方便分享和测试）
const startLevel = Number(new URLSearchParams(location.search).get('level'));
if (startLevel >= 1 && startLevel <= LEVELS.length) enterLevel(startLevel - 1);
$('#btn-back').addEventListener('click', leaveLevel);
$('#btn-export').addEventListener('click', onExport);
initInput({
  move: doMove,
  wait: doWait,
  rewind: doRewind,
  undo: doUndo,
  restart: doRestart,
  hint: doHint,
});
if (debugMode) initDebug();
// 演示中点击地图可以跳过
$('#map-wrap').addEventListener('click', () => { if (demo) stopDemo(); });

// 离开页面前把没结束的记录补完
window.addEventListener('pagehide', () => {
  if (game && telemetry.hasActive() && !game.won) {
    telemetry.endLevel(false, { t: game.t, round: game.round });
  }
});
