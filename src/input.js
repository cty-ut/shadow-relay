// src/input.js —— 键盘、滑动、按钮（需求文档 5.3）

export function initInput(handlers) {
  const KEY_DIRS = {
    ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
    KeyW: 'U', KeyS: 'D', KeyA: 'L', KeyD: 'R',
  };

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = KEY_DIRS[e.key] ?? KEY_DIRS[e.code];
    if (dir) {
      e.preventDefault();
      if (!e.repeat) handlers.move(dir);
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) handlers.wait();
      return;
    }
    if (e.code === 'KeyR') {
      e.preventDefault();
      if (!e.repeat) handlers.rewind();
      return;
    }
    if (e.code === 'KeyZ') {
      e.preventDefault();
      if (!e.repeat) handlers.undo();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (!e.repeat) handlers.restart();
      return;
    }
  });

  // 手机：在地图区域（地图和它周围的空白）滑动移动。
  // 拖动足够距离可连续走多步；快速轻扫（没拖满一步）在手指抬起时也算一步。
  const swipeEl = document.getElementById('map-wrap');
  const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
  let track = null;
  swipeEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      track = { x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, at: 0, moved: false };
    } else {
      track = null;
    }
  }, { passive: true });
  swipeEl.addEventListener('touchmove', (e) => {
    if (!track) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - track.x;
    const dy = t.clientY - track.y;
    if (Math.hypot(dx, dy) >= 40) {
      const now = performance.now();
      if (now - track.at >= 90) {
        handlers.move(dirOf(dx, dy));
        track.at = now;
        track.x = t.clientX;
        track.y = t.clientY;
        track.moved = true;
      }
    }
  }, { passive: false });
  swipeEl.addEventListener('touchend', (e) => {
    if (track && !track.moved) {
      const t = e.changedTouches[0];
      const dx = t.clientX - track.x0;
      const dy = t.clientY - track.y0;
      if (Math.hypot(dx, dy) >= 20) handlers.move(dirOf(dx, dy));
    }
    track = null;
  }, { passive: true });
  swipeEl.addEventListener('touchcancel', () => { track = null; }, { passive: true });

  // 游戏界面里禁止整个网页被拖动 / 回弹（时间轴除外，长关卡的时间轴需要左右滑）
  const gameScreen = document.getElementById('game-screen');
  document.addEventListener('touchmove', (e) => {
    if (gameScreen.classList.contains('active') && !e.target.closest('#timeline')) e.preventDefault();
  }, { passive: false });

  for (const btn of document.querySelectorAll('#controls [data-act]')) {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'wait') handlers.wait();
      else if (act === 'rewind') handlers.rewind();
      else if (act === 'undo') handlers.undo();
      else if (act === 'restart') handlers.restart();
      else if (act === 'hint') handlers.hint();
    });
  }
}
