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

  // 手机：在地图上滑动移动（拖动足够距离可连续走多步）
  const mapEl = document.getElementById('map');
  let track = null;
  mapEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      track = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: 0 };
    } else {
      track = null;
    }
  }, { passive: true });
  mapEl.addEventListener('touchmove', (e) => {
    if (!track) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - track.x;
    const dy = t.clientY - track.y;
    if (Math.hypot(dx, dy) >= 44) {
      const now = performance.now();
      if (now - track.at >= 90) {
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U');
        handlers.move(dir);
        track.at = now;
        track.x = t.clientX;
        track.y = t.clientY;
      }
    }
  }, { passive: false });
  mapEl.addEventListener('touchend', () => { track = null; }, { passive: true });
  mapEl.addEventListener('touchcancel', () => { track = null; }, { passive: true });

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
