// src/engine.js —— 纯逻辑游戏引擎
// 不碰 DOM、不依赖任何浏览器 API，可在 Node 中直接复用（求解器/测试）。
// 规则严格按《影子接力》需求文档第 3 节实现，有歧义处以 3.5 的算法为准。

export const DIRS = {
  U: { x: 0, y: -1 },
  D: { x: 0, y: 1 },
  L: { x: -1, y: 0 },
  R: { x: 1, y: 0 },
};

export const ACTIONS = ['U', 'D', 'L', 'R', 'W'];

const PLATE_CHANNELS = { '1': 1, '2': 2, '3': 3 };
const DOOR_CHANNELS = { A: 1, B: 2, C: 3, a: 1, b: 2, c: 3 };

// ---------------------------------------------------------------- 解析关卡

export function parseLevel(def) {
  const rows = def.map;
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const cells = [];
  const plates = []; // { x, y, channel }
  const doors = [];  // { x, y, channel, type: 'normal' | 'reverse' }
  const boxes = [];   // 箱子初始位置
  let start = null;
  let end = null;

  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x] ?? '#';
      switch (ch) {
        case '#': row.push('wall'); break;
        case '.': row.push('floor'); break;
        case 'S': row.push('start'); start = { x, y }; break;
        case 'E': row.push('end'); end = { x, y }; break;
        case 'o': row.push('floor'); boxes.push({ x, y }); break;
        default: {
          if (PLATE_CHANNELS[ch] != null) {
            row.push('plate');
            plates.push({ x, y, channel: PLATE_CHANNELS[ch] });
          } else if (DOOR_CHANNELS[ch] != null) {
            const isReverse = ch === ch.toLowerCase();
            row.push('door');
            doors.push({ x, y, channel: DOOR_CHANNELS[ch], type: isReverse ? 'reverse' : 'normal' });
          } else {
            row.push('wall');
          }
        }
      }
    }
    cells.push(row);
  }
  if (!start) throw new Error('关卡缺少起点 S');
  const level = {
    id: def.id,
    name: def.name,
    hints: def.hints ?? [],
    guide: def.guide ?? null,
    solution: def.solution,
    width,
    height,
    cells,
    plates,
    doors,
    start,
    end,
    boxes,
    maxSteps: def.maxSteps,
    maxShadows: def.maxShadows,
  };
  return withIndex(level);
}

// 给关卡加上按格子编号（i = y * width + x）的数据，供 resolveTick 和求解器快速计算
const DIR_KEYS = ['U', 'D', 'L', 'R'];
function withIndex(level) {
  const { width, height, cells } = level;
  const n = width * height;
  const passable = new Uint8Array(n); // 0 = 墙
  const isDoor = new Int16Array(n).fill(-1); // 门在 doors 里的下标
  const nb = {}; // nb[dir][i] = 目标格编号，越界为 -1
  for (const d of DIR_KEYS) nb[d] = new Int32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      passable[i] = cells[y][x] === 'wall' ? 0 : 1;
      for (const d of DIR_KEYS) {
        const tx = x + DIRS[d].x, ty = y + DIRS[d].y;
        nb[d][i] = tx < 0 || ty < 0 || tx >= width || ty >= height ? -1 : ty * width + tx;
      }
    }
  }
  level.doors.forEach((d, k) => { isDoor[d.y * width + d.x] = k; });
  level.idx = {
    passable,
    isDoor,
    nb,
    plates: level.plates.map((p) => ({ i: p.y * width + p.x, channel: p.channel })),
    doors: level.doors.map((d) => ({ i: d.y * width + d.x, channel: d.channel, reverse: d.type === 'reverse' })),
    start: level.start.y * width + level.start.x,
    end: level.end ? level.end.y * width + level.end.x : -1,
    boxes: level.boxes.map((b) => b.y * width + b.x),
  };
  return level;
}

// 门的开闭（3.1）：普通门 = 该通道任一板被按下时开；反向门 = 该通道没有任何板被按下时开；
// 门上站着角色或箱子时门不会关。pos：所有角色和箱子的格子编号。返回每扇门是否开（下标同 level.doors）。
export function doorOpenList(level, pos) {
  const { plates, doors } = level.idx;
  let pressed = 0; // 位掩码：第 c 位 = 通道 c 被按下
  for (const p of plates) if (pos.includes(p.i)) pressed |= 1 << p.channel;
  return doors.map((d) => {
    if (pos.includes(d.i)) return true;
    const on = (pressed >> d.channel) & 1;
    return d.reverse ? !on : !!on;
  });
}

// 一步的结算（3.5 第 2–5 步），游戏和求解器共用这一份规则。
// pos：按优先级排列的角色格子编号（玩家，影子 1，影子 2 ……）；acts：各自的操作；boxes：箱子的格子编号。
// 返回 { next, wants, ok, boxes }：新位置、是否想移动、移动是否成功、箱子的新位置。
//
// 箱子：走进箱子所在的格子就是推它，箱子向同方向移动一格。只有当箱子的目标格
// 不是墙、不是本步开始时关着的门、不是起点或终点、本步开始时上面没有箱子也没有角色，推才成功；
// 推不动 = 这一步没走成。箱子的目标格也参与抢格：和别人的目标冲突时，优先级低的一方失败。
export function resolveTick(level, pos, acts, boxes = []) {
  const { passable, isDoor, nb, start, end } = level.idx;
  const n = pos.length;
  const open = doorOpenList(level, boxes.length ? pos.concat(boxes) : pos);   // 2. 本步开始时的门
  const target = new Array(n).fill(-1);
  const wants = new Array(n).fill(false);
  const ok = new Array(n).fill(false);
  const push = new Array(n).fill(-1);      // 推的是第几个箱子
  const boxTarget = new Array(n).fill(-1); // 箱子要去的格子

  // 3. 墙 / 关着的门 / 推不动的箱子 → 失败
  for (let k = 0; k < n; k++) {
    if (acts[k] === 'W') continue;
    wants[k] = true;
    const t = nb[acts[k]][pos[k]];
    target[k] = t;
    if (t < 0 || !passable[t]) continue;
    if (isDoor[t] >= 0 && !open[isDoor[t]]) continue;
    const b = boxes.length ? boxes.indexOf(t) : -1;
    if (b >= 0) {
      const t2 = nb[acts[k]][t];
      if (t2 < 0 || !passable[t2] || t2 === start || t2 === end) continue;
      if (isDoor[t2] >= 0 && !open[isDoor[t2]]) continue;
      if (boxes.includes(t2) || pos.includes(t2)) continue;
      push[k] = b;
      boxTarget[k] = t2;
    }
    ok[k] = true;
  }

  // 4. 冲突消解，反复执行直到没有变化
  let changed = true;
  while (changed) {
    changed = false;
    // a. 交换 → 两者都失败
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (ok[a] && ok[b] && target[a] === pos[b] && target[b] === pos[a]) {
          ok[a] = ok[b] = false; changed = true;
        }
      }
    }
    // b. 抢格（起点格除外；箱子的目标格也算）→ 只有优先级最高的保留
    for (let a = 0; a < n; a++) {
      if (!ok[a]) continue;
      for (let b = a + 1; b < n; b++) {
        if (!ok[b]) continue;
        const clash = (target[b] === target[a] && target[a] !== start) ||
          (boxTarget[a] >= 0 && (target[b] === boxTarget[a] || boxTarget[b] === boxTarget[a])) ||
          (boxTarget[b] >= 0 && target[a] === boxTarget[b]);
        if (clash) { ok[b] = false; changed = true; }
      }
    }
    // c. 占格（起点格除外）：目标格上的角色本步不移动或移动失败 → 失败
    for (let a = 0; a < n; a++) {
      if (!ok[a] || target[a] === start) continue;
      for (let b = 0; b < n; b++) {
        if (b !== a && pos[b] === target[a] && (!wants[b] || !ok[b])) { ok[a] = false; changed = true; break; }
      }
    }
  }

  // 5. 同时生效
  const next = pos.map((p, k) => (ok[k] ? target[k] : p));
  let nextBoxes = boxes;
  if (boxes.length) {
    nextBoxes = boxes.slice();
    for (let k = 0; k < n; k++) if (ok[k] && push[k] >= 0) nextBoxes[push[k]] = boxTarget[k];
  }
  return { next, wants, ok, boxes: nextBoxes };
}

const same = (a, b) => a.x === b.x && a.y === b.y;

const cloneShadow = (s) => ({
  script: [...s.script],
  scriptOk: [...s.scriptOk],
  trajectory: s.trajectory.map((p) => ({ ...p })),
  pos: { ...s.pos },
  liveOk: [...s.liveOk],
});

// ---------------------------------------------------------------- Game

export class Game {
  constructor(levelDef) {
    this.level = parseLevel(levelDef);
    this.totalSteps = 0;   // 本次尝试累计操作数（不做撤销回退，用于统计展示）
    this._reset();
  }

  _reset() {
    const { start } = this.level;
    this.t = 0;
    this.round = 1;
    this.player = { ...start };
    this.boxes = this.level.boxes.map((b) => ({ ...b }));
    this.shadows = [];     // [{ script, scriptOk, trajectory, pos, liveOk }] 按生成顺序，优先级同序
    this.script = [];      // 本轮已按下的键（包括没走成的）
    this.scriptOk = [];    // 本轮每个按键是否走成（W 算走成），时间轴显示灰色箭头用
    this.trajectory = [];  // 本轮每步之后玩家所在格（轨迹[t-1] 为第 t 步后位置）
    this.undoStack = [];
    this.won = false;
  }

  // ---- 查询 ----

  get shadowCount() { return this.shadows.length; }
  get canRewind() { return !this.won && this.shadows.length < this.level.maxShadows; }
  get canMove() { return !this.won && this.t < this.level.maxSteps; }
  get canUndo() { return !this.won && this.undoStack.length > 0; }

  cellAt(x, y) {
    if (y < 0 || y >= this.level.height || x < 0 || x >= this.level.width) return 'wall';
    return this.level.cells[y][x];
  }

  isStart(p) { return same(p, this.level.start); }

  // 门是否开。positions: 玩家 + 所有影子的位置数组。
  // 规则（3.1 / 3.5.9）：普通门 = 该通道任一板被按下时开；反向门 = 该通道没有任何板被按下时开；
  // 门上站着角色时门不会关（视为开）。
  doorStates(positions) {
    const open = doorOpenList(this.level, positions.map((p) => this._i(p)));
    return new Map(this.level.doors.map((d, k) => [d.x + ',' + d.y, open[k]]));
  }

  _i(p) { return p.y * this.level.width + p.x; }
  _p(i) { return { x: i % this.level.width, y: Math.floor(i / this.level.width) }; }

  doorIsOpen(x, y, positions) {
    return this.doorStates(positions).get(x + ',' + y) ?? true;
  }

  // 当前压力板被按下情况（渲染用）
  pressedPlates(positions) {
    return this.level.plates.filter((plate) => positions.some((p) => same(p, plate)));
  }

  // 所有会压板、会卡住门的东西：玩家、影子、箱子
  allPositions() {
    return [this.player, ...this.shadows.map((s) => s.pos), ...this.boxes];
  }

  // 影子预告：接下来 3 步会去的位置（取录制那一轮的原始轨迹）
  // trajectory[n-1] 是第 n 步之后的位置（1 起数）
  shadowPreview(shadowIndex, ahead = 3) {
    const s = this.shadows[shadowIndex];
    if (!s) return [];
    const dots = [];
    for (let k = 1; k <= ahead; k++) {
      const n = this.t + k;              // 第 n 步
      if (n > s.script.length) break;    // 剧本执行完，原地等待
      const before = n >= 2 ? (s.trajectory[n - 2] ?? this.level.start) : this.level.start;
      const after = s.trajectory[n - 1] ?? before;
      if (!same(after, before)) dots.push(after); // 只标真正会移动的步
    }
    return dots;
  }

  // ---- 快照 / 撤销 ----

  _snapshot() {
    return {
      t: this.t,
      round: this.round,
      player: { ...this.player },
      boxes: this.boxes.map((b) => ({ ...b })),
      script: [...this.script],
      scriptOk: [...this.scriptOk],
      trajectory: this.trajectory.map((p) => ({ ...p })),
      shadows: this.shadows.map(cloneShadow),
    };
  }

  _restore(snap) {
    this.t = snap.t;
    this.round = snap.round;
    this.player = { ...snap.player };
    this.boxes = snap.boxes.map((b) => ({ ...b }));
    this.script = [...snap.script];
    this.scriptOk = [...snap.scriptOk];
    this.trajectory = snap.trajectory.map((p) => ({ ...p }));
    this.shadows = snap.shadows.map(cloneShadow);
  }

  undo() {
    if (!this.canUndo) return { ok: false, reason: this.won ? 'won' : 'empty' };
    const snap = this.undoStack.pop();
    this._restore(snap);
    return { ok: true };
  }

  // ---- 操作 ----

  // 每输入一次，整个世界前进一步。返回值供渲染做反馈。
  step(action) {
    if (this.won) return { ok: false, reason: 'won' };
    if (this.t >= this.level.maxSteps) return { ok: false, reason: 'maxSteps' };
    if (!ACTIONS.includes(action)) return { ok: false, reason: 'badAction' };

    const prevT = this.t;
    this.undoStack.push(this._snapshot());
    this.totalSteps++;

    // 1. 每个角色的本步操作：玩家 = a；影子 = 剧本[t]（越界为 W）
    const acts = [action, ...this.shadows.map((s) => s.script[this.t] ?? 'W')];
    const pos = [this.player, ...this.shadows.map((s) => s.pos)].map((p) => this._i(p));

    // 2–5. 结算（见 resolveTick）
    const r = resolveTick(this.level, pos, acts, this.boxes.map((b) => this._i(b)));
    const boxesMoved = r.boxes.some((b, k) => b !== this._i(this.boxes[k]));
    this.boxes = r.boxes.map((b) => this._p(b));
    const actors = acts.map((a, k) => ({
      isPlayer: k === 0, index: k - 1, action: a, wants: r.wants[k], ok: r.ok[k], pos: this._p(r.next[k]),
    }));
    const moved = [];
    const failed = [];
    for (const a of actors) {
      if (a.wants && a.ok) moved.push({ isPlayer: a.isPlayer, index: a.index, to: { ...a.pos } });
      else if (a.wants) failed.push({ isPlayer: a.isPlayer, index: a.index, dir: a.action });
    }
    this.player = { ...actors[0].pos };
    for (const a of actors) {
      if (!a.isPlayer) this.shadows[a.index].pos = { ...a.pos };
    }

    // 6. t += 1；剧本记录的是按下的键（包括没走成的）
    const t = this.t;
    this.t += 1;
    this.script.push(action);
    this.scriptOk.push(!actors[0].wants || actors[0].ok);
    this.trajectory.push({ ...this.player });

    // 7. 记录每个角色本步的按键是否走成。
    //    revived：录制时没走成、这一轮却走成了的按键（时间轴上灰色箭头变实心）
    const blockedShadows = [];
    const revived = [];
    for (const a of actors) {
      if (a.isPlayer) continue;
      const s = this.shadows[a.index];
      const ok = !a.wants || a.ok;
      s.liveOk[t] = ok;
      if (!ok) blockedShadows.push(a.index);
      if (a.wants && ok && s.scriptOk[t] === false) revived.push(a.index);
    }

    // 8. 玩家站在 E 上 → 通关
    if (this.level.end && same(this.player, this.level.end)) this.won = true;

    return { ok: true, t: this.t, prevT, moved, failed, blockedShadows, revived, boxesMoved, won: this.won };
  }

  // 回溯：本轮按键存为新剧本生成新影子，时间回到开头
  rewind() {
    if (this.won) return { ok: false, reason: 'won' };
    if (this.shadows.length >= this.level.maxShadows) return { ok: false, reason: 'maxShadows' };

    this.undoStack.push(this._snapshot());
    const start = this.level.start;
    // 这一轮玩家走过的路线（倒带动画用）
    const path = [{ ...start }, ...this.trajectory.map((p) => ({ ...p }))];
    this.shadows.push({
      script: [...this.script],
      scriptOk: [...this.scriptOk],
      trajectory: this.trajectory.map((p) => ({ ...p })),
      pos: { ...start },
      liveOk: [],
    });
    this.script = [];
    this.scriptOk = [];
    this.trajectory = [];
    this.t = 0;
    this.round += 1;
    this.player = { ...start };
    this.boxes = this.level.boxes.map((b) => ({ ...b }));
    for (const s of this.shadows) { s.pos = { ...start }; s.liveOk = []; }
    return { ok: true, round: this.round, newShadowIndex: this.shadows.length - 1, path };
  }

  // 重开：回到本关初始状态，清空所有影子（撤销历史也清空）
  restart() {
    this._reset();
    return { ok: true };
  }
}
