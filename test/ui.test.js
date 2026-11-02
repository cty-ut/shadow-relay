// test/ui.test.js —— UI 集成冒烟测试（需要 jsdom：npm install 后运行）
// 在 jsdom 中加载 index.html，用键盘事件完整玩通关卡，验证渲染层、新手引导、三级提示与演示、
// 标题画面、继续游戏、章末/结尾弹窗、箱子引导、点板高亮、星标、静音开关、数据记录。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let jsdom;
try {
  ({ JSDOM: jsdom } = await import('jsdom'));
} catch {
  jsdom = null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYMAP = {
  U: ['ArrowUp', 'ArrowUp'],
  D: ['ArrowDown', 'ArrowDown'],
  L: ['ArrowLeft', 'ArrowLeft'],
  R: ['ArrowRight', 'ArrowRight'],
  W: [' ', 'Space'],
};

test('UI 集成：标题/引导/提示/章末结尾/继续游戏/箱子引导/点板高亮/星标/静音/导出', { skip: jsdom === null }, async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new jsdom(html, { url: 'http://localhost/?debug=1', pretendToBeVisual: true });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
  globalThis.location = window.location;
  globalThis.localStorage = window.localStorage;

  await import('../src/main.js');
  await sleep(50);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const press = (a) => {
    const [k, c] = KEYMAP[a];
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, code: c, bubbles: true, cancelable: true }));
  };
  const key = (k, c) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, code: c, bubbles: true, cancelable: true }));
  const rewind = () => key('r', 'KeyR');
  const playSolution = async (solution) => {
    for (const ch of solution) {
      if (ch === '|') rewind();
      else press(ch);
      await sleep(5);
    }
    await sleep(700);
  };

  const next = async () => {
    $$('#fx-win .win-actions button').find((b) => b.textContent === '下一关').click();
    await sleep(50);
  };
  const won = () => $('#fx-win').classList.contains('show');
  const enterCard = async (i) => {
    $$('.level-card')[i].click();
    await sleep(50);
  };

  // ---- 标题画面（初始）----
  assert.ok($('#title-screen').classList.contains('active'), '初始应显示标题画面');
  assert.ok(!$('#select-screen').classList.contains('active'));
  assert.equal($$('.level-card').length, 50);
  assert.equal($$('.chapter-title').length, 5, '选关页按章节分组');
  assert.equal($('#btn-continue').hidden, true, '没有任何记录时不显示继续');

  // 玩法说明：打开 / 关闭
  $('#btn-help').click();
  assert.ok($('#fx-help').classList.contains('show'), '玩法说明应打开');
  $('#btn-help-close').click();
  assert.ok(!$('#fx-help').classList.contains('show'));
  assert.equal($$('#fx-help .help-item').length, 3, '玩法说明应有 3 张图示');

  // 静音开关：切换 + 持久化
  const audioBtn = $('#btn-audio');
  assert.ok(!audioBtn.classList.contains('muted'));
  audioBtn.click();
  assert.ok(audioBtn.classList.contains('muted'));
  assert.equal(window.localStorage.getItem('shadowRelay.muted.v1'), '1', '静音状态应存 localStorage');
  audioBtn.click();
  assert.ok(!audioBtn.classList.contains('muted'));
  assert.equal(window.localStorage.getItem('shadowRelay.muted.v1'), '0');

  // 开始游戏（没有记录）→ 第 1 关
  $('#btn-start').click();
  await sleep(50);
  assert.ok($('#game-screen').classList.contains('active'));
  assert.equal($('#level-name').textContent, '1 · 踩板开门');
  $('#btn-back').click();
  await sleep(50);
  assert.ok($('#select-screen').classList.contains('active'));

  // ---- 关卡 1：点板高亮、移动引导 ----
  await enterCard(0);
  assert.equal($('#level-name').textContent, '1 · 踩板开门');
  assert.equal($('[data-act="rewind"]').hidden, true, 'maxShadows=0 时隐藏回溯按钮');
  assert.ok($('#guide').classList.contains('show'), '关卡 1 应有移动引导');
  assert.ok($('#hint-box').classList.contains('hidden'), '提示默认隐藏');

  const plateCell = $('.cell.plate');
  const doorCell = $('.cell.door');
  assert.equal(plateCell.dataset.ch, undefined, '压力板不显示通道数字');
  assert.equal(doorCell.dataset.ch, undefined, '门不显示通道数字');
  plateCell.click();
  assert.ok(doorCell.classList.contains('hl'), '点板应高亮同通道的门');
  assert.ok(plateCell.classList.contains('hl'));
  plateCell.click();
  assert.ok(!doorCell.classList.contains('hl'), '再点一次取消高亮');

  press('R');
  await sleep(5);
  assert.ok(!$('#guide').classList.contains('show'), '走一步后引导消失');
  await playSolution('RRR');
  assert.ok(won(), '关卡 1 应通关');
  assert.ok(!$('#fx-win .win-par').hidden, '按最优步数通关应显示「最优解！」');

  // ---- 关卡 2：新手引导 + 最优解星标 ----
  await next();
  assert.equal($('#level-name').textContent, '2 · 留下来帮忙');
  assert.ok(!$('#guide').classList.contains('show'), '进入关卡时不弹引导');
  press('D');
  await sleep(5);
  assert.ok(!$('#guide').classList.contains('show'), '只站了 1 步，还不触发');
  press('W');
  await sleep(5);
  assert.ok($('#guide').classList.contains('show'), '在板上停留 2 步后触发引导');
  assert.ok($('[data-act="rewind"]').classList.contains('pulse'), '回溯按钮闪烁');
  rewind();
  await sleep(30);
  assert.match($('#guide').textContent, /影子会重复你刚才的动作/);
  assert.ok($('#map').classList.contains('rewinding'), '回溯时播放倒带动画');
  await sleep(700);
  assert.ok(!$('#map').classList.contains('rewinding'), '倒带动画结束');
  assert.equal($('#fx-rewind .label').textContent, '第 2 轮', '回溯应显示轮数');
  assert.equal($$('.tl-row').length, 3, '时间轴应有 t/你/影1 三行');
  assert.equal($$('.dot').length, 1, '影子预告应有 1 个点');
  press('R');
  await sleep(5);
  key('z', 'KeyZ');
  await sleep(5);
  await playSolution('RRR');
  assert.ok(won(), '关卡 2 应通关');
  assert.ok(!$('#guide').classList.contains('show'), '通关后引导消失');
  assert.match($('.win-stats').textContent, /用了 1 个影子/);
  assert.ok(!$('#fx-win .win-par').hidden, '关卡 2 按解法通关应是最优解');
  assert.equal($('#fx-win h2').textContent, '通关！', '普通关卡标题');

  // ---- 关卡 3：先乱走再「重开」，然后按解法打完 ----
  await next();
  press('D');
  press('R');
  $('[data-act="restart"]').click();
  await sleep(20);
  await playSolution('DD|RRRR');
  assert.ok(won(), '关卡 3 应通关');

  for (const [n, sol] of [[4, 'DDRRR|RWWWWRRR'], [5, 'RRRD|WRRRRRR'], [6, 'DWU|RRRRRR'], [7, 'D|RRRD|WRRRRRR']]) {
    await next();
    if (n === 6) {
      // 反向门：用斜条纹区分，不再显示通道数字和「反」字
      const revDoor = $('.cell.door.reverse');
      assert.ok(revDoor, '关卡 6 应有反向门');
      assert.equal(revDoor.querySelector('.rev-mark'), null);
      assert.equal(revDoor.dataset.ch, undefined);
      // 第一次出现反向门：开场引导，第一次回溯后消失
      assert.ok($('#guide').classList.contains('show'), '关卡 6 应有反向门的开场引导');
      assert.match($('#guide').textContent, /斜条纹/);
    }
    await playSolution(sol);
    assert.ok(won(), `关卡 ${n} 应通关`);
  }

  // ---- 关卡 8：灰色箭头 → 复活闪光 ----
  await next();
  await playSolution('RRRR|');
  assert.equal($$('.tl-row')[2].querySelectorAll('.tlc.miss').length, 3, '影子剧本里 3 个撞门的按键应是灰色');
  press('L');
  await sleep(5);
  press('W');
  await sleep(5);
  assert.equal($$('.tl-row')[2].querySelectorAll('.tlc.revived').length, 1, '门开后那个按键走成了，变实心');
  assert.equal($$('.tl-row')[2].querySelectorAll('.tlc.just').length, 1, '刚走成的那一格闪一下');
  assert.match($('#guide').textContent, /重复的是按键/, '第一次看到盲按生效时弹出"发现时刻"气泡');
  assert.ok($('.entity.shadow').classList.contains('revived'), '盲按生效那一刻影子身上应闪一下');
  await playSolution('RRDD');
  assert.ok(won(), '关卡 8 应通关');

  // ---- 关卡 9：三级提示 + 自动演示；通关后是章末标题 ----
  await next();
  const hintBtn = $('[data-act="hint"]');
  hintBtn.click();
  await sleep(10);
  assert.ok(!$('#hint-box').classList.contains('hidden'));
  assert.equal($('#hint-text').textContent.split('\n').length, 1, '第 1 次只显示提示 1');
  assert.equal(hintBtn.textContent, '提示 2');
  hintBtn.click();
  await sleep(10);
  assert.equal($('#hint-text').textContent.split('\n').length, 2, '第 2 次显示提示 1 和 2');
  assert.equal(hintBtn.textContent, '看演示');
  hintBtn.click();
  await sleep(1200);
  assert.match($('#status').textContent, /演示中/);
  assert.ok($$('.entity.shadow').length >= 1 || $$('.tl-row')[1].querySelectorAll('.tlc.has').length > 0, '演示在播放解法');
  press('U'); // 任意键跳过演示
  await sleep(20);
  assert.doesNotMatch($('#status').textContent, /演示中/);
  assert.equal($('#steps-label').textContent, '0/10', '跳过演示后回到本关开头');
  assert.equal($$('.entity.shadow').length, 0);
  assert.ok(!won(), '演示不算通关');
  await playSolution('RDDR|LWRRRRRR');
  assert.ok(won(), '关卡 9 应通关');
  assert.equal($('#fx-win h2').textContent, '第 1 章完成', '章末关卡标题');

  // ---- 回到选关：章节进度 + 星标 + 记录数 ----
  $$('#fx-win .win-actions button').find((b) => b.textContent === '选关').click();
  await sleep(50);
  assert.ok($('#select-screen').classList.contains('active'));
  assert.equal($$('.level-card.cleared').length, 9, '9 关都应标记已通关');
  assert.match($$('#select-screen .chapter-title')[0].textContent, /已通关 9 \/ 9/, '章标题显示已通关数');
  assert.ok($$('.level-card')[0].querySelector('.lv-star'), '关卡 1 应有最优星标');
  assert.match($('#record-count').textContent, /10 条/); // 9 条通关 + 开头那次没通关的进入

  // ---- 继续游戏：最后玩过、还没通关的那一关 ----
  await enterCard(9);
  assert.equal($('#level-name').textContent, '10 · 晚点出发');
  press('W');
  await sleep(5);
  $('#btn-back').click();
  await sleep(30);
  const contBtn = $('#btn-continue');
  assert.equal(contBtn.hidden, false, '有没通关的记录时应显示继续');
  assert.match(contBtn.textContent, /第 10 关/);
  contBtn.click();
  await sleep(50);
  assert.equal($('#level-name').textContent, '10 · 晚点出发', '继续应进入第 10 关');
  $('#btn-back').click();
  await sleep(30);

  // ---- 长关卡时间轴横向滚动 ----
  await enterCard(27); // 第 28 关，maxSteps=18
  assert.equal($('#level-name').textContent, '28 · 一人三板');
  assert.ok($('#timeline').classList.contains('long'), '18 步的关卡时间轴应可横向滚动');
  press('R');
  await sleep(5); // 自动滚动不应报错
  $('#btn-back').click();
  await sleep(30);

  // ---- 第 30 关：箱子引导 ----
  await enterCard(29);
  assert.equal($('#level-name').textContent, '30 · 推箱子');
  assert.ok($('#guide').classList.contains('show'), '第一次进箱子关应显示引导');
  assert.match($('#guide').textContent, /走进箱子就能推动它/);
  press('R');
  await sleep(5);
  assert.ok($('#guide').classList.contains('show'), '还没推过箱子，引导不消失');
  press('D');
  await sleep(5);
  assert.ok(!$('#guide').classList.contains('show'), '第一次推箱子后引导消失');
  await playSolution('URRR');
  assert.ok(won(), '关卡 30 应通关');
  assert.equal($('#fx-win h2').textContent, '通关！', '非章末关卡标题');
  $$('#fx-win .win-actions button').find((b) => b.textContent === '选关').click();
  await sleep(50);

  // ---- 第 50 关：结尾画面 ----
  await enterCard(49);
  assert.equal($('#level-name').textContent, '50 · 终章');
  await playSolution('RDDRURWU|LRRRRRRRRR');
  assert.ok(won(), '关卡 50 应通关');
  assert.equal($('#fx-win h2').textContent, '全部通关！', '结尾画面标题');
  assert.ok(!$('#fx-win .win-ending').hidden);
  assert.match($('#fx-win .win-stats').textContent, /通关 11\/50/);
  assert.match($('#fx-win .win-stats').textContent, /总用时/);
  $$('#fx-win .win-actions button').find((b) => b.textContent === '回到选关').click();
  await sleep(50);
  assert.ok($('#select-screen').classList.contains('active'));
  assert.equal($$('.level-card.cleared').length, 11);

  // ---- 试玩数据字段 ----
  const { getRecords } = await import('../src/telemetry.js');
  const records = getRecords();
  const clearedRecords = records.filter((r) => r.cleared);
  assert.ok(clearedRecords.length >= 11);
  for (const r of clearedRecords.slice(0, 9)) {
    assert.equal(r.cleared, true);
    assert.ok(r.moves > 0);
    assert.ok(r.startTime && r.endTime);
    assert.ok(r.firstInputDelay !== null);
  }
  const rec = (id) => records.find((r) => r.levelId === id);
  assert.ok(rec(2).undos >= 1, '关卡 2 的撤销应被记录');
  assert.ok(rec(3).restarts >= 1, '关卡 3 的重开应被记录');
  assert.equal(rec(9).hintLevel, 3, '关卡 9 用到了第 3 级提示');
  assert.equal(rec(8).hintLevel, 0);

  // 通关过的关卡不再出现新手引导
  await enterCard(1);
  await sleep(20);
  press('D'); press('W'); press('W');
  await sleep(10);
  assert.ok(!$('#guide').classList.contains('show'), '通关后不再出现引导');
  $('#btn-back').click();
  await sleep(20);

  // 导出按钮（jsdom 环境剪贴板不可用，只验证不崩溃）
  $('#btn-export').click();
  await sleep(150);
  assert.ok($('#toast').classList.contains('show'), '导出应有提示');

  // 清空数据
  $('#debug-clear').click();
  await sleep(20);
  assert.equal(getRecords().length, 0);
  assert.equal($$('.level-card.cleared').length, 0);
  assert.equal($('#btn-continue').hidden, true);

  // 清空后：从选关回标题，开始游戏重新进第 1 关
  $('#btn-back-title').click();
  await sleep(20);
  assert.ok($('#title-screen').classList.contains('active'));
  $('#btn-start').click();
  await sleep(50);
  assert.equal($('#level-name').textContent, '1 · 踩板开门', '清空后开始游戏应进第 1 关');
  assert.ok($('#guide').classList.contains('show'), '通关记录清空后引导重新出现');
  $('#btn-back').click();
  await sleep(30);
});
