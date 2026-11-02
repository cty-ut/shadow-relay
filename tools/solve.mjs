// tools/solve.mjs —— 分析所有关卡：node tools/solve.mjs [--clean] [关卡编号…]
// --clean：2 个影子的关卡也检查"是否必须盲按"（很慢，每关可能要几分钟）
// 对每关：最少影子数、最少步数、解的数量、是否必须用"按键 ≠ 轨迹"、难度指标，
// 并把求解器找到的解放回真实游戏引擎里验证一遍。

import { LEVELS, applySolution } from '../src/levels.js';
import { Game } from '../src/engine.js';
import { analyze } from '../src/solver.js';

const args = process.argv.slice(2);
const withClean = args.includes('--clean');
const only = args.filter((a) => a !== '--clean').map(Number);
const rows = [];
for (const def of LEVELS) {
  if (only.length && !only.includes(def.id)) continue;
  const t0 = Date.now();
  const a = analyze(def, { skipClean: def.maxShadows >= 2 && !withClean });
  const ms = Date.now() - t0;
  if (!a.solvable) {
    rows.push({ 关卡: def.id, 名字: def.name, 结果: '无解!!' });
    continue;
  }
  const verified = applySolution(new Game(def), a.solution);
  const designed = def.solution ? applySolution(new Game(def), def.solution) : null;
  rows.push({
    关卡: def.id,
    名字: def.name,
    影子: `${a.minShadows}/${def.maxShadows}`,
    步数: `${a.steps}/${def.maxSteps}`,
    解数: a.ways,
    盲按: a.blindRequired ? '必须' : (a.cleanAborted ? '?' : ''),
    难度: a.tightness,
    求解器的解: a.solution + (verified ? '' : ' ✗验证失败'),
    设计解: designed === false ? '✗失败' : '',
    ms,
  });
}
console.table(rows);
