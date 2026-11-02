// test/engine.test.js —— node --test 运行
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, parseLevel, resolveTick } from '../src/engine.js';
import { LEVELS, applySolution } from '../src/levels.js';

const pos = (x, y) => ({ x, y });
const eqPos = (a, b) => assert.deepEqual({ ...a }, pos(b[0], b[1]));

// ---------------------------------------------------------------- 全部关卡的解法

test('所有关卡的 solution 都能通关', () => {
  for (const def of LEVELS) {
    const game = new Game(def);
    const won = applySolution(game, def.solution);
    assert.ok(won, `关卡 ${def.id}「${def.name}」解法未通关`);
    assert.ok(game.t <= def.maxSteps, `关卡 ${def.id} 超出 maxSteps`);
  }
});

test('影子走到终点不算通关（终点对影子是普通地板）', () => {
  // 关卡 2 第二轮：影子剧本 RRRR（第一轮对着关着的门按的），第二轮门开后影子会走到 E
  const game = new Game(LEVELS[1]);
  for (const a of ['R', 'R', 'R', 'R']) game.step(a); // 全被门挡住，但按键被记录
  game.rewind();
  game.step('D'); // 玩家踩板
  game.step('W'); // 影子走到 (3,1) 门上
  game.step('W'); // 影子走到 (4,1) 终点上
  eqPos(game.shadows[0].pos, [4, 1]);
  assert.equal(game.won, false);
});

// ---------------------------------------------------------------- 冲突规则

// 交换：A 的目标是 B 的位置，B 的目标是 A 的位置 → 都失败
test('交换：对向而行的两个角色都失败', () => {
  const def = { id: 99, name: 't', map: ['######', '#S...#', '######'], maxSteps: 10, maxShadows: 1 };
  const game = new Game(def);
  game.step('R'); game.step('R'); game.step('L'); // 剧本 [R,R,L]
  game.rewind();
  game.step('W'); // t0：影子 R → (2,1)，玩家原地
  game.step('R'); // t1：玩家跟进 (2,1)，影子同时去 (3,1)
  eqPos(game.player, [2, 1]);
  eqPos(game.shadows[0].pos, [3, 1]);
  // t2：玩家 R→(3,1)（影子当前位置），影子 L→(2,1)（玩家当前位置）→ 交换，都失败
  const res2 = game.step('R');
  eqPos(game.player, [2, 1]);
  eqPos(game.shadows[0].pos, [3, 1]);
  assert.ok(res2.failed.some((f) => f.isPlayer));
  assert.ok(res2.failed.some((f) => !f.isPlayer));
});

// 抢格：多个角色目标同一格 → 只有优先级最高的保留
test('抢格：玩家优先，影子被挡', () => {
  const game = new Game(LEVELS[6]); // 关卡 4，maxShadows=2
  applySolution(game, 'D|RRRD|');   // 两轮结束，影子1=[D]，影子2=[R,R,R,D]
  const res = game.step('R');       // 第三轮 t0：玩家和影子2 都想进 (2,1)
  eqPos(game.player, [2, 1]);
  eqPos(game.shadows[1].pos, [1, 1]); // 影子2 抢格失败，留在起点
  assert.deepEqual(res.blockedShadows, [1]);
});

// 占格：目标格上站着不动的角色 → 移动失败
test('占格：不能走进站着不动的角色', () => {
  const def = { id: 99, name: 't', map: ['#####', '#S.E#', '#####'], maxSteps: 8, maxShadows: 1 };
  const game = new Game(def);
  game.step('R'); game.step('W'); // 剧本 [R,W]，影子第二轮会停在 (2,1)
  game.rewind();
  game.step('W');                 // 影子 R → (2,1)
  const res = game.step('R');     // 玩家想进 (2,1)，影子原地等待 → 失败
  assert.equal(res.ok, true);
  eqPos(game.player, [1, 1]);
  assert.ok(res.failed.some((f) => f.isPlayer));
});

// 排队跟进：目标格上的角色本步成功离开 → 允许跟进
test('排队跟进：跟着前面的角色一格一格前进', () => {
  const game = new Game(LEVELS[6]);
  applySolution(game, 'D|RRRD|');
  game.step('W');                 // t0：影子2 → (2,1)，玩家在起点
  const res = game.step('R');     // t1：玩家进 (2,1) 的同时影子2 离开去 (3,1)
  eqPos(game.player, [2, 1]);
  eqPos(game.shadows[1].pos, [3, 1]);
  assert.ok(res.moved.some((m) => m.isPlayer));
  assert.ok(res.moved.some((m) => !m.isPlayer && m.index === 1));
});

// 起点重叠：起点格允许多个角色重叠（包括走进被占的起点）
test('起点重叠：影子可以走回被玩家占着的起点', () => {
  const def = { id: 99, name: 't', map: ['#####', '#S..#', '#####'], maxSteps: 8, maxShadows: 1 };
  const game = new Game(def);
  game.step('R'); game.step('L'); // 剧本 [R,L]
  game.rewind();
  // 回溯后所有角色都在起点重叠
  eqPos(game.player, [1, 1]);
  eqPos(game.shadows[0].pos, [1, 1]);
  game.step('W');                 // 影子 R → (2,1)
  game.step('W');                 // 影子 L → (1,1) 起点格（玩家站着不动）→ 允许
  eqPos(game.shadows[0].pos, [1, 1]);
  eqPos(game.player, [1, 1]);
});

// 门被卡住：门上站着角色时门不会关
test('门被卡住：角色站在门上时门保持打开，后来者可以跟进', () => {
  const def = { id: 99, name: 't', map: ['#######', '#S.A..#', '#1#####'], maxSteps: 12, maxShadows: 2 };
  const game = new Game(def);
  // 门状态直接计算：玩家站在门上、没人踩板 → 门视为开
  const states = game.doorStates([pos(3, 1)]);
  assert.equal(states.get('3,1'), true);

  // 完整对局：影子2 站在门上迟迟不离开（板已放开），玩家从后面跟进
  game.step('D'); game.step('U'); game.rewind();                 // 影子1 = [D,U]
  for (const a of ['R', 'R', 'W', 'W', 'R']) game.step(a);       // 影子2 = [R,R,W,W,R]
  game.rewind();
  for (const a of ['W', 'W', 'W', 'R']) game.step(a);            // 玩家跟到 (2,1)
  const res = game.step('R'); // 玩家进 (3,1) 门格：门本该关（没板），但影子2 站在上面 → 开，且影子2 同时离开
  assert.ok(res.moved.some((m) => m.isPlayer), '玩家应能跟进门格');
  eqPos(game.player, [3, 1]);
  eqPos(game.shadows[1].pos, [4, 1]);
});

// 反向门：没有板被按下时才开
test('反向门：踩板时关，离开板后开', () => {
  const def = { id: 99, name: 't', map: ['#####', '#S.a#', '#1###'], maxSteps: 8, maxShadows: 1 };
  const game = new Game(def);
  game.step('D'); game.step('W'); game.step('U'); // 剧本 [D,W,U]：影子踩板两个时间步后离开
  game.rewind();
  game.step('R');  // 玩家 → (2,1)，影子 → 板
  const r1 = game.step('R'); // t1：影子在板上 → 反向门关 → 玩家被挡
  assert.ok(r1.failed.some((f) => f.isPlayer));
  eqPos(game.player, [2, 1]);
  game.step('R');  // t2：影子仍在板上（本步离开）→ 步开始时门仍关 → 还是挡
  eqPos(game.player, [2, 1]);
  game.step('R');  // t3：影子已离板 → 反向门开 → 玩家走上门格
  eqPos(game.player, [3, 1]);
});

// ---------------------------------------------------------------- 核心设定：剧本记录的是按键

test('剧本记录撞门的按键，下一轮门开了影子真的走过去', () => {
  const def = { id: 99, name: 't', map: ['######', '#S.A.#', '#1####'], maxSteps: 10, maxShadows: 1 };
  const game = new Game(def);
  game.step('R');            // → (2,1)
  const r2 = game.step('R'); // 撞关着的门，原地不动，但按键被记录
  assert.ok(r2.failed.some((f) => f.isPlayer));
  eqPos(game.player, [2, 1]);
  assert.deepEqual(game.script, ['R', 'R']);
  game.rewind();
  assert.deepEqual(game.shadows[0].script, ['R', 'R']);
  game.step('D');  // 玩家去踩板
  game.step('W');  // t1：影子的第二个 R 这次走成了 → 穿过门
  eqPos(game.shadows[0].pos, [3, 1]);
});

test('影子被挡住：这一步原地不动，剧本照常往下执行', () => {
  const def = { id: 99, name: 't', map: ['#######', '#S.A..#', '#1#####'], maxSteps: 12, maxShadows: 1 };
  const game = new Game(def);
  for (const a of ['R', 'R', 'R', 'R']) game.step(a); // 第一轮：后三个 R 都撞门，但被记录
  game.rewind();
  // 第二轮：玩家 t0 原地等，t1 才去踩板；影子 t1 撞门被挡，t2 门开了走过去，t3 继续到 (4,1)
  const results = ['W', 'D', 'W', 'W'].map((a) => game.step(a));
  assert.deepEqual(results[1].blockedShadows, [0]);
  eqPos(game.shadows[0].pos, [4, 1]);
});

test('按键是否走成：记录到 scriptOk，之后走成了报告 revived', () => {
  const def = { id: 99, name: 't', map: ['######', '#S.A.#', '#1####'], maxSteps: 10, maxShadows: 1 };
  const game = new Game(def);
  game.step('R'); game.step('R'); game.step('W'); // 第二个 R 撞门
  assert.deepEqual(game.scriptOk, [true, false, true]);
  game.rewind();
  assert.deepEqual(game.shadows[0].scriptOk, [true, false, true]);
  assert.deepEqual(game.scriptOk, []);
  game.step('D');                  // t0：影子 R 本来就走成了，不算 revived
  const r = game.step('W');        // t1：影子的第二个 R 这次穿过了门
  assert.deepEqual(r.revived, [0]);
  assert.deepEqual(game.shadows[0].liveOk, [true, true]);
  game.undo();
  assert.deepEqual(game.shadows[0].liveOk, [true], '撤销要回退 liveOk');
});

test('回溯返回这一轮的路线（倒带动画用）', () => {
  const game = new Game(LEVELS[1]);
  game.step('D'); game.step('W');
  const res = game.rewind();
  assert.deepEqual(res.path, [pos(1, 1), pos(1, 2), pos(1, 2)]);
});

// ---------------------------------------------------------------- 撤销 / 回溯 / 步数限制

const summary = (game) => JSON.stringify({
  t: game.t,
  round: game.round,
  player: game.player,
  script: game.script,
  trajectory: game.trajectory,
  shadows: game.shadows.map((s) => [s.script, s.scriptOk, s.pos, s.liveOk, s.trajectory]),
  scriptOk: game.scriptOk,
  undoDepth: game.undoStack.length,
});

test('撤销一步能精确回到之前的状态', () => {
  const game = new Game(LEVELS[6]);
  applySolution(game, 'D|RRRD|WR');
  const before = summary(game);
  const snap0 = summary(game);
  game.step('R');
  assert.notEqual(summary(game), snap0);
  game.undo();
  assert.equal(summary(game), before);
});

test('撤销一次回溯：回到上一轮最后一步，并删掉刚生成的影子', () => {
  const game = new Game(LEVELS[1]);
  game.step('D');
  const before = summary(game); // 第一轮 t=1，玩家在板上
  game.rewind();                // 生成影子，进入第二轮
  assert.equal(game.round, 2);
  assert.equal(game.shadowCount, 1);
  game.step('R');               // 第二轮走一步
  game.undo();                  // 撤掉这一步
  game.undo();                  // 撤掉回溯本身
  assert.equal(game.round, 1);
  assert.equal(game.shadowCount, 0);
  assert.equal(summary(game), before);
});

test('连续撤销可以一路退回初始状态，空栈时撤销无效', () => {
  const game = new Game(LEVELS[5]);
  applySolution(game, 'DWU|RRR');
  while (game.undoStack.length > 0) game.undo();
  const fresh = new Game(LEVELS[5]);
  assert.deepEqual(JSON.parse(summary(game)), JSON.parse(summary(fresh)));
  const res = game.undo();
  assert.equal(res.ok, false);
});

test('达到 maxSteps 后不能再移动，但可以回溯；影子满了不能回溯', () => {
  const game = new Game(LEVELS[1]); // maxSteps=6, maxShadows=1
  for (let i = 0; i < 6; i++) game.step('W');
  assert.equal(game.step('W').ok, false);
  assert.equal(game.canMove, false);
  const rw = game.rewind();
  assert.equal(rw.ok, true);      // 步数用完仍可回溯
  assert.equal(game.canRewind, false); // 影子已满
  assert.equal(game.rewind().ok, false);
});

test('通关后不能再操作', () => {
  const game = new Game(LEVELS[1]);
  applySolution(game, LEVELS[1].solution);
  assert.equal(game.won, true);
  assert.equal(game.step('U').ok, false);
  assert.equal(game.rewind().ok, false);
});

test('影子预告取录制那一轮的原始轨迹', () => {
  const game = new Game(LEVELS[3]);
  applySolution(game, 'DDRRR|');
  // 影子剧本 [D,D,R,R,R]，录制轨迹：第1步→(1,2) 第2步→(1,3) 第3步→(2,3)
  const dots = game.shadowPreview(0);
  assert.deepEqual(dots, [pos(1, 2), pos(1, 3), pos(2, 3)]);
});

// ---------------------------------------------------------------- 箱子

test('箱子：推到板上，门打开并保持', () => {
  // 地图：S . o 1 . A E —— 把箱子推上板 1，门 A 开
  const g = new Game({ id: 99, name: 't', map: ['#########', '#S.o1.AE#', '#########'], maxSteps: 10, maxShadows: 0 });
  g.step('R');                 // 玩家 (2,1)
  const r = g.step('R');       // 推箱子 (3,1)→(4,1) 板上
  assert.ok(r.boxesMoved);
  assert.deepEqual(g.boxes, [pos(4, 1)]);
  assert.equal(g.doorStates(g.allPositions()).get('6,1'), true);
});

test('箱子：推不动（前面是墙、箱子、角色）就等于没走成', () => {
  const g = new Game({ id: 99, name: 't', map: ['######', '#S.oo#', '######'], maxSteps: 10, maxShadows: 0 });
  g.step('R');
  const r = g.step('R');       // 箱子前面还有箱子
  assert.ok(r.failed.some((f) => f.isPlayer));
  assert.deepEqual(g.boxes, [pos(3, 1), pos(4, 1)]);
});

test('箱子：每一轮开始时回到原位，影子会重复推它', () => {
  const g = new Game({ id: 99, name: 't', map: ['#######', '#S.o.1#', '#######'], maxSteps: 10, maxShadows: 1 });
  g.step('R'); g.step('R');    // 箱子推到 (4,1)
  g.rewind();
  assert.deepEqual(g.boxes, [pos(3, 1)], '回溯后箱子回原位');
  g.step('D');                 // 玩家撞墙；影子 R
  g.step('W');                 // 影子推箱子
  assert.deepEqual(g.boxes, [pos(4, 1)]);
  g.undo();
  assert.deepEqual(g.boxes, [pos(3, 1)], '撤销要回退箱子');
});

test('箱子：两人同时推同一个箱子，优先级低的失败', () => {
  const level = parseLevel({ id: 99, name: 't', map: ['#####', '#.S.#', '#.o.#', '#...#', '#####'], maxSteps: 5, maxShadows: 1 });
  const i = (x, y) => y * level.width + x;
  // 玩家在 (1,2) 往右推，影子在 (2,1) 往下推，同一个箱子 (2,2)
  const r = resolveTick(level, [i(1, 2), i(2, 1)], ['R', 'D'], [i(2, 2)]);
  assert.deepEqual(r.ok, [true, false]);
  assert.deepEqual(r.boxes, [i(3, 2)]);
});
