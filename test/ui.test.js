// test/ui.test.js —— UI 集成冒烟测试（需要 jsdom：npm install 后运行）
// 在 jsdom 中加载 index.html，用键盘事件完整玩通 9 关，验证渲染层、新手引导、三级提示与演示、数据记录、导出与调试面板。

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

test('UI 集成：完整玩通 9 关 + 引导 + 提示 + 试玩记录 + 导出 + 调试面板', { skip: jsdom === null }, async () => {
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
  const rewind = () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true, cancelable: true }));
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

  // 初始：选关页 + 调试面板
  assert.ok($('#select-screen').classList.contains('active'));
  assert.equal($$('.level-card').length, 50);
  assert.equal($$('.chapter-title').length, 5, '选关页按章节分组');
  assert.ok($('#debug-panel').classList.contains('show'), '?debug=1 应显示调试面板');

  // 关卡 1：不需要影子，回溯按钮隐藏；有移动引导，第一步后消失
  $$('.level-card')[0].click();
  await sleep(50);
  assert.ok($('#game-screen').classList.contains('active'));
  assert.equal($('#level-name').textContent, '1 · 踩板开门');
  assert.equal($('[data-act="rewind"]').hidden, true, 'maxShadows=0 时隐藏回溯按钮');
  assert.ok($('#guide').classList.contains('show'), '关卡 1 应有移动引导');
  assert.ok($('#hint-box').classList.contains('hidden'), '提示默认隐藏');
  press('R');
  await sleep(5);
  assert.ok(!$('#guide').classList.contains('show'), '走一步后引导消失');
  await playSolution('RRR');
  assert.ok(won(), '关卡 1 应通关');

  // 关卡 2：进入时没有引导；站在板上停留 2 步后出现，回溯后换文字
  await next();
  assert.equal($('#level-name').textContent, '2 · 留下来帮忙');
  assert.equal($('[data-act="rewind"]').hidden, false);
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
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true }));
  await sleep(5);
  await playSolution('RRR');
  assert.ok(won(), '关卡 2 应通关');
  assert.ok(!$('#guide').classList.contains('show'), '通关后引导消失');
  assert.match($('.win-stats').textContent, /用了 1 个影子/);

  // 关卡 3：先乱走再「重开」，然后按解法打完
  await next();
  press('D');
  press('R');
  $('[data-act="restart"]').click();
  await sleep(20);
  await playSolution('DD|RRRR');
  assert.ok(won(), '关卡 3 应通关');

  for (const [n, sol] of [[4, 'DDRRR|RWWWWRRR'], [5, 'RRRD|WRRRRRR'], [6, 'DWU|RRRRRR'], [7, 'D|RRRD|WRRRRRR']]) {
    await next();
    await playSolution(sol);
    assert.ok(won(), `关卡 ${n} 应通关`);
  }

  // 关卡 8：时间轴上撞门的按键是灰色空心，第二轮走成后变实心
  await next();
  await playSolution('RRRR|');
  assert.equal($$('.tl-row')[2].querySelectorAll('.tlc.miss').length, 3, '影子剧本里 3 个撞门的按键应是灰色');
  press('L');
  await sleep(5);
  press('W');
  await sleep(5);
  assert.equal($$('.tl-row')[2].querySelectorAll('.tlc.revived').length, 1, '门开后那个按键走成了，变实心');
  assert.equal($$('.tl-row')[2].querySelectorAll('.tlc.just').length, 1, '刚走成的那一格闪一下');
  await playSolution('RRDD');
  assert.ok(won(), '关卡 8 应通关');

  // 关卡 9：三级提示 —— 提示 1、提示 2、自动演示；演示后回到本关开头，按任意键可跳过
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

  // 回到选关
  $$('#fx-win .win-actions button').find((b) => b.textContent === '选关').click();
  await sleep(50);
  assert.ok($('#select-screen').classList.contains('active'));
  assert.equal($$('.level-card.cleared').length, 9, '9 关都应标记已通关');
  assert.match($('#record-count').textContent, /9 条/);

  // 试玩数据字段
  const { getRecords } = await import('../src/telemetry.js');
  const records = getRecords();
  assert.equal(records.length, 9);
  for (const r of records) {
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
  $$('.level-card')[1].click();
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
});
