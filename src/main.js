// src/main.js —— 控制器：串起引擎、画面、输入、数据记录、音效

import { LEVELS, CHAPTERS, solutionActions } from './levels.js';
import { Game } from './engine.js';
import { GameView } from './render.js';
import { initInput } from './input.js';
import * as telemetry from './telemetry.js';
import * as audio from './audio.js';

const $ = (sel) => document.querySelector(sel);
const debugMode = new URLSearchParams(location.search).has('debug');

const titleScreen = $('#title-screen');
const selectScreen = $('#select-screen');
const gameScreen = $('#game-screen');
const screens = [titleScreen, selectScreen, gameScreen];

let game = null;
let view = null;
let levelIndex = -1;
let demo = null;   // 自动演示：{ game, timer }
let guide = null;  // 新手引导：{ type, phase, onPlate, bumps }

function show(screen) {
  for (const s of screens) s.classList.toggle('active', s === screen);
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

// ---- 选关 ----

function buildSelect() {
  const list = $('#level-list');
  list.innerHTML = '';
  // 每章通关数统计
  const chapterTotal = new Map();
  const chapterCleared = new Map();
  for (const lv of LEVELS) {
    chapterTotal.set(lv.chapter, (chapterTotal.get(lv.chapter) ?? 0) + 1);
    if (telemetry.isCleared(lv.id)) {
      chapterCleared.set(lv.chapter, (chapterCleared.get(lv.chapter) ?? 0) + 1);
    }
  }
  let grid = null;
  let chapter = null;
  LEVELS.forEach((lv, i) => {
    if (lv.chapter !== chapter) {
      chapter = lv.chapter;
      const title = document.createElement('div');
      title.className = 'chapter-title';
      title.innerHTML =
        `第 ${chapter} 章 · ${CHAPTERS[chapter]}` +
        `<span class="ch-count">已通关 ${chapterCleared.get(chapter) ?? 0} / ${chapterTotal.get(chapter)}</span>`;
      grid = document.createElement('div');
      grid.className = 'chapter-grid';
      list.append(title, grid);
    }
    const cleared = telemetry.isCleared(lv.id);
    const card = document.createElement('button');
    card.className = 'level-card' + (cleared ? ' cleared' : '');
    card.title = lv.name;
    card.innerHTML =
      `<span class="lv-num">${lv.id}</span>` +
      `<span class="lv-name">${lv.name}</span>` +
      (telemetry.hasPar(lv.id) ? '<span class="lv-star" title="最优解">★</span>' : '');
    card.addEventListener('click', () => enterLevel(i));
    grid.appendChild(card);
  });
  $('#record-count').textContent = `已记录 ${telemetry.getRecords().length} 条试玩数据`;

  // 继续游戏：最后玩过、还没通关的那一关
  const target = telemetry.getContinueTarget();
  const btn = $('#btn-continue');
  btn.hidden = target == null;
  if (target != null) {
    const def = LEVELS[target - 1];
    btn.textContent = `继续 · 第 ${target} 关「${def.name}」`;
  }
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
  const before = audio.snapshot(game);
  const res = game.step(dir);
  if (!res.ok) return;
  telemetry.markInput();
  telemetry.countMove();
  view.onStep(res, game);
  audio.playStep(res, game, before);
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
  audio.playRewind();
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
      audio.playRewind();
      view.onRewind(dg.rewind(), dg);
      demo.timer = setTimeout(next, 1100);
    } else {
      const before = audio.snapshot(dg);
      const res = dg.step(a);
      view.onStep(res, dg);
      audio.playStep(res, dg, before);
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
  if (guide.type === 'box') view.showGuide('走进箱子就能推动它。箱子压在板上，门就一直开着');
}

function guideAfterStep(from, dir, res) {
  if (!guide) return;
  if (res.won) { view.hideGuide(); guide = null; return; }
  if (guide.type === 'move') {
    if (guide.phase === 'wait') { view.hideGuide(); guide.phase = 'done'; }
    return;
  }
  if (guide.type === 'box') {
    if (res.boxesMoved) { view.hideGuide(); guide = null; }
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
  const def = LEVELS[levelIndex];
  telemetry.markCleared(def.id);
  const optimal = def.par != null && game.t <= def.par;
  if (optimal) telemetry.markPar(def.id);
  audio.playWin();

  const isLast = levelIndex === LEVELS.length - 1;
  if (isLast) {
    const stats = telemetry.getStats();
    view.endFx({
      shadows: game.shadowCount,
      steps: game.totalSteps,
      optimal,
      clearedCount: stats.clearedCount,
      totalText: fmtDuration(stats.totalMs),
      onReplay: () => enterLevel(levelIndex),
      onSelect: () => leaveLevel(),
    });
    if (debugMode) syncDebug();
    return;
  }
  const chapterEnd = LEVELS[levelIndex + 1].chapter !== def.chapter;
  view.winFx({
    title: chapterEnd ? `第 ${def.chapter} 章完成` : '通关！',
    shadows: game.shadowCount,
    steps: game.totalSteps,
    optimal,
    hasNext: true,
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
show(titleScreen);
// ?level=N 直接进入第 N 关（方便分享和测试）
const startLevel = Number(new URLSearchParams(location.search).get('level'));
if (startLevel >= 1 && startLevel <= LEVELS.length) enterLevel(startLevel - 1);
$('#btn-back').addEventListener('click', leaveLevel);
$('#btn-export').addEventListener('click', onExport);

// 标题画面
$('#btn-start').addEventListener('click', () => {
  const cont = telemetry.getContinueTarget();
  const firstUncleared = LEVELS.findIndex((lv) => !telemetry.isCleared(lv.id));
  enterLevel(cont != null ? cont - 1 : (firstUncleared >= 0 ? firstUncleared : 0));
});
$('#btn-select').addEventListener('click', () => {
  buildSelect();
  show(selectScreen);
});
$('#btn-help').addEventListener('click', () => $('#fx-help').classList.add('show'));
$('#btn-help-close').addEventListener('click', () => $('#fx-help').classList.remove('show'));
$('#btn-back-title').addEventListener('click', () => show(titleScreen));

// 继续游戏
$('#btn-continue').addEventListener('click', () => {
  const t = telemetry.getContinueTarget();
  if (t != null) enterLevel(t - 1);
});

// 静音开关（右上角，状态存 localStorage）
const audioBtn = $('#btn-audio');
function refreshAudioBtn() {
  audioBtn.classList.toggle('muted', audio.isMuted());
  audioBtn.setAttribute('aria-label', audio.isMuted() ? '开启音效' : '静音');
}
audioBtn.addEventListener('click', () => {
  audio.toggleMuted();
  refreshAudioBtn();
});
refreshAudioBtn();
audio.initAudio();

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
