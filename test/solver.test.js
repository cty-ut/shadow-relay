// test/solver.test.js —— 求解器与关卡质量检查
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, parseLevel } from '../src/engine.js';
import { LEVELS, applySolution } from '../src/levels.js';
import { search, planToSolution } from '../src/solver.js';

// 已知例外：第 7 关给了 2 个影子，但用"卡门"技巧 1 个影子也能过（第 2 章第 17 关专门教这个）
const FEWER_SHADOWS_OK = new Set([7]);

test('每关在规定的影子数内有解，且影子再少一个就过不去', () => {
  for (const def of LEVELS) {
    const level = parseLevel(def);
    const r = search(level, def.maxShadows);
    assert.ok(r.solvable, `关卡 ${def.id}「${def.name}」无解`);
    assert.ok(applySolution(new Game(def), planToSolution(r.plan)), `关卡 ${def.id} 求解器的解在游戏里没通关`);
    if (def.maxShadows > 0 && !FEWER_SHADOWS_OK.has(def.id)) {
      assert.equal(search(level, def.maxShadows - 1).solvable, false, `关卡 ${def.id}「${def.name}」少一个影子也能过`);
    }
  }
});

test('clean 模式：不许盲按时，第 8 关无解；第 3 关有解', () => {
  const by = (id) => LEVELS.find((l) => l.id === id);
  assert.equal(search(by(8), 1, { mode: 'clean' }).solvable, false);
  assert.equal(search(by(3), 1, { mode: 'clean' }).solvable, true);
});

test('求解器给出最少步数', () => {
  const r = search(LEVELS[1], 1); // 关卡 2：D | RRR
  assert.equal(r.steps, 3);
  assert.equal(planToSolution(r.plan), 'D|RRR');
});
