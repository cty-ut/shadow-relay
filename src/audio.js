// src/audio.js —— 音效和背景音乐（Web Audio 代码合成，不引入任何音频文件）
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
let sfxBus = null;    // 音效总线
let musicBus = null;  // 背景音乐总线（带低通，声音更柔和）
let unlocked = false;

// iOS：用户第一次触摸 / 按键时才能出声，所以在这里惰性创建并唤醒
function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      sfxBus = ctx.createGain();
      sfxBus.connect(ctx.destination);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      musicBus = ctx.createGain();
      musicBus.gain.value = muted ? 0 : 1;
      musicBus.connect(lp).connect(ctx.destination);
    } catch {
      ctx = null;
    }
  }
  // iOS 来电、切后台后状态可能是 interrupted
  if (ctx && (ctx.state === 'suspended' || ctx.state === 'interrupted')) ctx.resume().catch(() => {});
  return ctx;
}

function unlock() {
  // iOS 17+：声明为"播放"类音频，手机侧面的静音开关打开时也能出声
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch { /* 不支持就算了 */ }
  const c = ensureCtx();
  if (!c || unlocked) return;
  // 老版本 iOS：必须在手势里真正播放一次声音才算解锁，这里播一段无声的
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch { /* 忽略 */ }
  unlocked = true;
  startMusic();
}

export function initAudio() {
  for (const ev of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']) {
    window.addEventListener(ev, unlock, true);
  }
  // 切到后台时暂停，回来时恢复
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !unlocked) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
  });
}

export function isMuted() { return muted; }

export function setMuted(v) {
  muted = !!v;
  if (musicBus && ctx) musicBus.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.15);
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

function tone(c, { f0, f1 = null, dur = 0.1, type = 'sine', gain = 0.1, delay = 0, bus = sfxBus }) {
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(bus);
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
  src.connect(bp).connect(g).connect(sfxBus);
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

// ---------------------------------------------------------------- 背景音乐
// 安静的循环：A 小调 Am–F–C–G，每小节一个柔和的和弦铺底，上面零星的五声音阶拨弦。
// 用"提前排程"的方式：每 100ms 检查一次，把接下来 0.3 秒内的音符排进 Web Audio 时间线。

const BEAT = 60 / 66;                 // 每拍秒数（66 BPM）
const EIGHTH = BEAT / 2;
const CHORDS = [                      // 每小节的和弦（频率，Hz）
  [110.0, 220.0, 261.63, 329.63],     // Am
  [87.31, 174.61, 220.0, 261.63],     // F
  [130.81, 196.0, 261.63, 329.63],    // C
  [98.0, 196.0, 246.94, 293.66],      // G
];
const PENTA = [440.0, 523.25, 587.33, 659.25, 783.99, 880.0]; // A 小调五声音阶
// 8 小节 × 8 个八分音符的旋律：-1 = 休止，其余是 PENTA 的下标（固定写死，每次循环都一样）
const MELODY = [
  [-1, -1, 2, -1, 3, -1, -1, -1], [1, -1, -1, -1, 0, -1, -1, -1],
  [-1, -1, 3, -1, 4, -1, 3, -1], [2, -1, -1, -1, -1, -1, -1, -1],
  [-1, -1, 2, -1, 3, -1, 5, -1], [4, -1, -1, 3, -1, -1, -1, -1],
  [-1, -1, 1, -1, 2, -1, 3, -1], [0, -1, -1, -1, -1, -1, -1, -1],
];

let musicTimer = null;
let nextTime = 0;
let stepIndex = 0;

function pad(c, freqs, t0, dur) {
  for (const f of freqs) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.022, t0 + 0.9);
    g.gain.setValueAtTime(0.022, t0 + dur - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.4);
    osc.connect(g).connect(musicBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.5);
  }
}

function pluck(c, f, t0) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.035, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
  osc.connect(g).connect(musicBus);
  osc.start(t0);
  osc.stop(t0 + 1.3);
}

function scheduleMusic() {
  if (!ctx || ctx.state !== 'running') return;
  while (nextTime < ctx.currentTime + 0.3) {
    const bar = Math.floor(stepIndex / 8) % MELODY.length;
    const pos = stepIndex % 8;
    if (!muted) {
      if (pos === 0) pad(ctx, CHORDS[bar % CHORDS.length], nextTime, BEAT * 4);
      const n = MELODY[bar][pos];
      if (n >= 0) pluck(ctx, PENTA[n], nextTime);
    }
    nextTime += EIGHTH;
    stepIndex++;
  }
}

function startMusic() {
  if (musicTimer || !ctx) return;
  nextTime = ctx.currentTime + 0.1;
  stepIndex = 0;
  musicTimer = setInterval(scheduleMusic, 100);
}
