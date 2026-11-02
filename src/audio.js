// src/audio.js —— 音效（Web Audio 代码合成，不引入任何音频文件）
// 门和板的变化通过比较上一步和这一步的 doorStates / pressedPlates 检测，不改引擎。

const MUTE_KEY = 'shadowRelay.muted.v1';

function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

let muted = loadMuted();
let ctx = null;

// iOS：用户第一次触摸 / 按键时才能出声，所以在这里惰性创建并唤醒
function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      ctx = null;
    }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function initAudio() {
  const unlock = () => ensureCtx();
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('touchstart', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

export function isMuted() { return muted; }

export function setMuted(v) {
  muted = !!v;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch { /* 忽略 */ }
  return muted;
}

export function toggleMuted() { return setMuted(!muted); }

function run(make) {
  if (muted) return;
  const c = ensureCtx();
  if (!c) return;
  try {
    make(c);
  } catch { /* 音频失败不影响游戏 */ }
}

function tone(c, { f0, f1 = null, dur = 0.1, type = 'sine', gain = 0.1, delay = 0 }) {
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(c, { dur = 0.09, gain = 0.15, freq = 500, delay = 0 }) {
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t0);
}

const S = {
  move: () => run((c) => tone(c, { f0: 720, dur: 0.05, type: 'sine', gain: 0.05 })),               // 很轻的短音
  bump: () => run((c) => tone(c, { f0: 150, f1: 90, dur: 0.09, type: 'triangle', gain: 0.2 })),    // 低沉的闷响
  plateOn: () => run((c) => tone(c, { f0: 1250, dur: 0.045, type: 'square', gain: 0.07 })),        // 咔哒（高）
  plateOff: () => run((c) => tone(c, { f0: 820, dur: 0.045, type: 'square', gain: 0.055 })),       // 咔哒（低）
  doorOpen: () => run((c) => tone(c, { f0: 300, f1: 620, dur: 0.15, type: 'sine', gain: 0.09 })),  // 上滑音
  doorClose: () => run((c) => tone(c, { f0: 620, f1: 300, dur: 0.15, type: 'sine', gain: 0.08 })), // 下滑音
  box: () => run((c) => noise(c, { dur: 0.1, gain: 0.16, freq: 420 })),                            // 摩擦声
  rewind: () => run((c) => tone(c, { f0: 950, f1: 160, dur: 0.38, type: 'sawtooth', gain: 0.06 })), // 倒带
  win: () => run((c) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    tone(c, { f0: f, dur: 0.13, type: 'sine', gain: 0.1, delay: i * 0.09 }))),                     // 上行琶音
};

export function playRewind() { S.rewind(); }
export function playWin() { S.win(); }

// 从游戏状态里截取板和门的情况（只读，不改引擎）
export function snapshot(game) {
  const positions = game.allPositions();
  return {
    pressed: new Set(game.pressedPlates(positions).map((p) => p.x + ',' + p.y)),
    doors: game.doorStates(positions),
  };
}

// 一步之后：玩家撞墙/撞门/推不动 → 闷响；推箱 → 摩擦；移动 → 短音；
// 板被按下/松开、门开/关 → 从上一步和这一步的状态差异里检测
export function playStep(res, game, before) {
  if (!res || !res.ok) return;
  const playerFailed = res.failed.some((f) => f.isPlayer);
  if (playerFailed) S.bump();
  else if (res.boxesMoved) S.box();
  else if (res.moved.some((m) => m.isPlayer)) S.move();

  if (!before) return;
  const after = snapshot(game);
  let pressed = false;
  let released = false;
  for (const k of after.pressed) if (!before.pressed.has(k)) pressed = true;
  for (const k of before.pressed) if (!after.pressed.has(k)) released = true;
  if (pressed) S.plateOn();
  else if (released) S.plateOff();

  let opened = false;
  let closed = false;
  for (const [k, v] of after.doors) {
    const b = before.doors.get(k);
    if (b === false && v === true) opened = true;
    if (b === true && v === false) closed = true;
  }
  if (opened) S.doorOpen();
  else if (closed) S.doorClose();
}
