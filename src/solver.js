// src/solver.js —— 关卡求解器与难度指标（M2）
// 纯逻辑，复用 engine.js 的 resolveTick，规则与游戏完全一致。
//
// 关键观察：前几轮录下的剧本可以是任意按键序列（撞墙、撞门的键也会原样记下），
// 所以"能否通关"等价于：最后一轮里 k 个影子 + 玩家同时行动，能否让玩家走到终点。
// 求解器在这个"联合行动"空间里做广度优先搜索（状态 = 所有角色的位置）。
//
// 两种模式：
//   free  —— 剧本可以包含没走成的按键（游戏的真实规则）
//   clean —— 额外要求每个影子在它录制的那一轮里，按的每个键都走成了（不用"按键 ≠ 轨迹"）。
//            同时模拟所有轮次：第 r 轮里只有前 r 个角色。
// free 能解而 clean 不能解 → 这关必须用"按键 ≠ 轨迹"。

import { parseLevel, resolveTick, doorOpenList } from './engine.js';

const ACTS = ['W', 'U', 'D', 'L', 'R']; // W 在前：同样短的解里优先选等待，解法更干净

// 所有角色的联合行动：5^n 种（clean 模式用）
function jointActions(n) {
  let list = [[]];
  for (let k = 0; k < n; k++) list = list.flatMap((a) => ACTS.map((x) => [...a, x]));
  return list.map((acts) => ({ acts, weight: 1 }));
}

// free 模式的剪枝：撞墙、撞本步开始时关着的门，效果和等待完全一样（3.5 第 3 步），
// 所以合并成一个 W，并把被合并的个数记成权重，保证"解数"仍按 5 种操作计。
function agentOptions(level, p, open) {
  const { passable, isDoor, nb } = level.idx;
  const opts = [];
  let wWeight = 1;
  for (const d of ['U', 'D', 'L', 'R']) {
    const t = nb[d][p];
    if (t < 0 || !passable[t] || (isDoor[t] >= 0 && !open[isDoor[t]])) wWeight++;
    else opts.push([d, 1]);
  }
  return [['W', wWeight], ...opts];
}

function prunedJoints(level, who, state, n) {
  const open = doorOpenList(level, state);
  let list = [{ acts: new Array(n), weight: 1 }];
  who.forEach((agent, j) => {
    const opts = agentOptions(level, state[j], open);
    const nextList = [];
    for (const { acts, weight } of list) {
      for (const [d, w] of opts) {
        const a = acts.slice();
        a[agent] = d;
        nextList.push({ acts: a, weight: weight * w });
      }
    }
    list = nextList;
  });
  return list;
}

// 搜索。k = 影子数。返回 { solvable, steps, ways, states, plan }
//   steps：最后一轮最少步数
//   ways：最少步数下的联合行动方案数（越少说明解越"窄"）
//   plan：一组解，按角色给出每步操作（[影子1, 影子2, …, 玩家]）
export function search(levelOrDef, k, { mode = 'free', maxStates = 3e6 } = {}) {
  const level = levelOrDef.idx ? levelOrDef : parseLevel(levelOrDef);
  const { start, end } = level.idx;
  const n = k + 1;                       // 角色：影子 1..k（录制顺序），玩家 = 第 k+1 个
  const joints = mode === 'clean' ? jointActions(n) : null;

  // 每一轮的角色（按优先级排列，存的是角色编号）：第 r 轮的"玩家"是角色 r，其余是更早的影子
  const rounds = mode === 'clean'
    ? Array.from({ length: n }, (_, r) => [r, ...Array.from({ length: r }, (_, j) => j)])
    : [[k, ...Array.from({ length: k }, (_, j) => j)]];
  // 状态：每一轮依次是 [这一轮的角色位置…, 这一轮的箱子位置（排好序）…]
  const initBoxes = level.idx.boxes;
  const nb = initBoxes.length;
  const offsets = [];
  let width = 0;
  for (const r of rounds) { offsets.push(width); width += r.length + nb; }

  // 状态键：格子数不超过 256 且位置不多时，打包成一个数字，否则用字符串
  const cells = level.width * level.height;
  const key = cells <= 256 && width <= 6
    ? (s) => s.reduce((acc, p) => acc * 256 + p, 0)
    : (s) => s.join(',');
  const init = [];
  for (const r of rounds) init.push(...r.map(() => start), ...[...initBoxes].sort((a, b) => a - b));
  const visited = new Map([[key(init), { parent: null, act: null, t: 0 }]]);
  let layer = new Map([[key(init), { state: init, ways: 1 }]]);
  const lastRound = rounds.length - 1;

  for (let t = 1; t <= level.maxSteps; t++) {
    const next = new Map();
    for (const [pk, { state, ways }] of layer) {
      const options = joints ?? prunedJoints(level, rounds[0], state, n);
      for (const { acts, weight } of options) {
        const ns = new Array(width);
        let valid = true;
        for (let r = 0; r < rounds.length && valid; r++) {
          const who = rounds[r];
          const off = offsets[r];
          const pos = who.map((_, j) => state[off + j]);
          const boxes = nb ? state.slice(off + who.length, off + who.length + nb) : [];
          const res = resolveTick(level, pos, who.map((a) => acts[a]), boxes);
          // clean：录制轮里"玩家"按的移动键必须走成
          if (mode === 'clean' && r < lastRound && res.wants[0] && !res.ok[0]) valid = false;
          for (let j = 0; j < who.length; j++) ns[off + j] = res.next[j];
          if (nb) {
            const sorted = [...res.boxes].sort((a, b) => a - b);
            for (let j = 0; j < nb; j++) ns[off + who.length + j] = sorted[j];
          }
        }
        if (!valid) continue;
        const nk = key(ns);
        const seen = visited.get(nk);
        if (seen && seen.t !== t) continue; // 更早就到过
        if (!seen) visited.set(nk, { parent: pk, act: acts, t });
        const entry = next.get(nk);
        if (entry) entry.ways += ways * weight;
        else next.set(nk, { state: ns, ways: ways * weight });
      }
      if (visited.size > maxStates) return { solvable: null, steps: null, ways: 0, states: visited.size, plan: null, aborted: true };
    }
    const winKeys = [...next.keys()].filter((nk) => next.get(nk).state[offsets[lastRound]] === end);
    if (winKeys.length) {
      const ways = winKeys.reduce((s, nk) => s + next.get(nk).ways, 0);
      return { solvable: true, steps: t, ways, states: visited.size, plan: rebuild(visited, winKeys[0], n) };
    }
    layer = next;
    if (!layer.size) break;
  }
  return { solvable: false, steps: null, ways: 0, states: visited.size, plan: null };
}

function rebuild(visited, nk, n) {
  const steps = [];
  for (let cur = nk; visited.get(cur).parent !== null; cur = visited.get(cur).parent) {
    steps.push(visited.get(cur).act);
  }
  steps.reverse();
  return Array.from({ length: n }, (_, a) => steps.map((acts) => acts[a]));
}

// 把一组解转成游戏用的解法字符串：影子剧本去掉末尾的等待，用 | 分隔
export function planToSolution(plan) {
  const scripts = plan.slice(0, -1).map((s) => s.join('').replace(/W+$/, ''));
  return [...scripts, plan[plan.length - 1].join('')].join('|');
}

// 一关的完整分析
export function analyze(def, opts = {}) {
  const level = parseLevel(def);
  const result = { id: def.id, name: def.name, maxShadows: def.maxShadows, maxSteps: def.maxSteps };

  // 最少需要几个影子
  let best = null;
  for (let k = 0; k <= def.maxShadows; k++) {
    const r = search(level, k, opts);
    if (r.solvable) { best = { k, ...r }; break; }
  }
  if (!best) return { ...result, solvable: false };

  // clean 模式要同时模拟每一轮，3 个影子时状态量太大，不做（结果记为"?"）；opts.skipClean 也可以跳过
  const clean = best.k >= 3 || opts.skipClean ? { aborted: true } : search(level, best.k, { ...opts, mode: 'clean' });
  const n = best.k + 1;
  // 窄度（0–10）：最短解里，每个角色每一步平均还有多少选择余地。
  // 余地 = log(解数) / (角色数 × 步数)，满分是每步 5 种操作随便选。和路线长短无关：
  // 路长但每步都很自由 → 低；路短但每步都卡死 → 高。只有玩家一个人时最短路通常唯一，不计（记 0）。
  const freedom = Math.log10(best.ways) / (n * best.steps);
  const tightness = best.k === 0 ? 0 : 10 * (1 - freedom / Math.log10(5));
  return {
    ...result,
    solvable: true,
    minShadows: best.k,
    steps: best.steps,
    ways: best.ways,
    states: best.states,
    blindRequired: clean.solvable === false,
    cleanAborted: !!clean.aborted,
    tightness: Math.round(tightness * 10) / 10,
    solution: planToSolution(best.plan),
  };
}
