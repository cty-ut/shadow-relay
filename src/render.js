// src/render.js —— 画面渲染与操作反馈（需求文档第 5 节）

const ARROW = { U: '↑', D: '↓', L: '←', R: '→', W: '·' };
const CHANNEL_CLASS = { 1: 'ch1', 2: 'ch2', 3: 'ch3' };

export class GameView {
  constructor(screenEl, game) {
    this.game = game;
    this.level = game.level;
    this.screen = screenEl;
    this.mapEl = screenEl.querySelector('#map');
    this.timelineEl = screenEl.querySelector('#timeline');
    this.hintBox = screenEl.querySelector('#hint-box');
    this.hintText = screenEl.querySelector('#hint-text');
    this.statusEl = screenEl.querySelector('#status');
    this.guideEl = screenEl.querySelector('#guide');
    this.cellEls = new Map();
    this.btns = new Map();
    for (const btn of screenEl.querySelectorAll('#controls [data-act]')) {
      this.btns.set(btn.dataset.act, btn);
    }
    this.hintLevel = 0;      // 0 = 没看提示，1/2 = 显示到第几条
    this.demo = false;       // 正在自动演示解法
    this.justRevived = [];   // 本步"灰色箭头变实心"的影子
    this.rwTimer = null;
    this.cell = 40;
    this.hlChannel = null;   // 点板高亮的通道
    this.longTimeline = this.level.maxSteps > 14; // 长关卡时间轴横向滚动
    this.playerEl = null;
    this.shadowEls = [];
    this.boxEls = [];
    this._onResize = () => this.layout();
    window.addEventListener('resize', this._onResize);

    screenEl.querySelector('#level-name').textContent = `${this.level.id} · ${this.level.name}`;
    this.buildMap();
    this.layout();
    this.sync(game, { snap: true });
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    for (const el of this.shadowEls) {
      this._clearBadgeTimer(el);
      if (el._revTimer) clearTimeout(el._revTimer);
    }
    this._stopRewindAnim();
    this.hideGuide();
  }

  // ---- 地图 ----

  buildMap() {
    this.mapEl.innerHTML = '';
    const { width, height, cells, plates, doors } = this.level;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const type = cells[y][x];
        const el = document.createElement('div');
        el.className = 'cell ' + type;
        if (type === 'plate') {
          const ch = plates.find((p) => p.x === x && p.y === y).channel;
          el.classList.add(CHANNEL_CLASS[ch]);
          el.addEventListener('click', () => this.toggleChannel(ch)); // 点板高亮同通道的门
        } else if (type === 'door') {
          const d = doors.find((p) => p.x === x && p.y === y);
          el.classList.add(CHANNEL_CLASS[d.channel], d.type);
          el.dataset.door = x + ',' + d.y;
        }
        this.mapEl.appendChild(el);
        this.cellEls.set(x + ',' + y, el);
      }
    }
    this.dotsLayer = document.createElement('div');
    this.dotsLayer.className = 'layer dots';
    this.entitiesLayer = document.createElement('div');
    this.entitiesLayer.className = 'layer entities';
    this.mapEl.append(this.dotsLayer, this.entitiesLayer);
  }

  // 点击一块板：高亮同通道的所有门和板，再点一次取消
  toggleChannel(channel) {
    this.hlChannel = this.hlChannel === channel ? null : channel;
    for (const d of this.level.doors) {
      this.cellEls.get(d.x + ',' + d.y).classList.toggle('hl', this.hlChannel === d.channel);
    }
    for (const p of this.level.plates) {
      this.cellEls.get(p.x + ',' + p.y).classList.toggle('hl', this.hlChannel === p.channel);
    }
  }

  layout() {
    const wrap = this.mapEl.parentElement;
    const availW = Math.max(120, wrap.clientWidth - 8);
    const availH = Math.max(120, wrap.clientHeight - 8);
    const cell = Math.max(20, Math.min(60, Math.floor(Math.min(availW / this.level.width, availH / this.level.height))));
    this.cell = cell;
    this.mapEl.style.width = this.level.width * cell + 'px';
    this.mapEl.style.height = this.level.height * cell + 'px';
    this.mapEl.style.fontSize = Math.round(cell * 0.42) + 'px';
    for (const [key, el] of this.cellEls) {
      const [x, y] = key.split(',').map(Number);
      el.style.width = cell + 'px';
      el.style.height = cell + 'px';
      el.style.transform = `translate(${x * cell}px, ${y * cell}px)`;
    }
    this.sync(this.game, { snap: true });
  }

  // ---- 角色 ----

  makeEntity(cls) {
    const el = document.createElement('div');
    el.className = 'entity ' + cls;
    const body = document.createElement('div');
    body.className = 'body';
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = '!';
    el.append(body, badge);
    return el;
  }

  ensureEntities() {
    while (this.boxEls.length < this.game.boxes.length) {
      const el = this.makeEntity('box');
      this.entitiesLayer.appendChild(el);
      this.boxEls.push(el);
    }
    if (!this.playerEl) {
      this.playerEl = this.makeEntity('player');
      this.entitiesLayer.appendChild(this.playerEl);
    }
    while (this.shadowEls.length < this.game.shadows.length) {
      const el = this.makeEntity('shadow');
      el.querySelector('.body').textContent = String(this.shadowEls.length + 1);
      this.entitiesLayer.appendChild(el);
      this.shadowEls.push(el);
    }
    while (this.shadowEls.length > this.game.shadows.length) {
      const el = this.shadowEls.pop();
      this._clearBadgeTimer(el);
      el.remove();
    }
  }

  positionEntity(el, p, snap) {
    if (snap) el.classList.add('no-anim');
    el.style.width = this.cell + 'px';
    el.style.height = this.cell + 'px';
    el.style.transform = `translate(${p.x * this.cell}px, ${p.y * this.cell}px)`;
    if (snap) {
      void el.offsetWidth;
      el.classList.remove('no-anim');
    }
  }

  // ---- 总同步 ----

  sync(game, { snap = false } = {}) {
    this.game = game;
    this.ensureEntities();
    this.positionEntity(this.playerEl, game.player, snap);
    game.boxes.forEach((b, i) => this.positionEntity(this.boxEls[i], b, snap));
    game.shadows.forEach((s, i) => {
      const el = this.shadowEls[i];
      this.positionEntity(el, s.pos, snap);
    });
    this.updateCells(game);
    this.updateDots(game);
    this.renderTimeline(game);
    this.updateHeader(game);
    this.updateHint();
    this.updateStatus(game);
    this.updateButtons(game);
  }

  updateCells(game) {
    const positions = game.allPositions();
    const doors = game.doorStates(positions);
    const held = new Set(this.heldDoors(game).map((d) => d.x + ',' + d.y));
    for (const d of this.level.doors) {
      const el = this.cellEls.get(d.x + ',' + d.y);
      el.classList.toggle('open', !!doors.get(d.x + ',' + d.y));
      el.classList.toggle('held', held.has(d.x + ',' + d.y));
    }
    const pressed = new Set(game.pressedPlates(positions).map((p) => p.x + ',' + p.y));
    for (const p of this.level.plates) {
      this.cellEls.get(p.x + ',' + p.y).classList.toggle('pressed', pressed.has(p.x + ',' + p.y));
    }
  }

  // 被"撑住"的门：本来该关，但因为门里站着人或箱子才开着
  heldDoors(game) {
    const positions = game.allPositions();
    const pressed = new Set(game.pressedPlates(positions).map((p) => p.channel));
    return this.level.doors.filter((d) => {
      const occupied = positions.some((p) => p.x === d.x && p.y === d.y);
      const natural = d.type === 'reverse' ? !pressed.has(d.channel) : pressed.has(d.channel);
      return occupied && !natural;
    });
  }

  updateDots(game) {
    this.dotsLayer.innerHTML = '';
    const d = Math.max(5, Math.round(this.cell * 0.2));
    game.shadows.forEach((s, i) => {
      for (const p of game.shadowPreview(i)) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        dot.style.width = d + 'px';
        dot.style.height = d + 'px';
        dot.style.transform = `translate(${p.x * this.cell + (this.cell - d) / 2}px, ${p.y * this.cell + (this.cell - d) / 2}px)`;
        this.dotsLayer.appendChild(dot);
      }
    });
  }

  renderTimeline(game) {
    const L = this.level;
    const rows = [];
    let cells = '';
    for (let i = 0; i <= L.maxSteps; i++) {
      cells += `<div class="tlc num ${i === game.t ? 'cur' : ''}">${i}</div>`;
    }
    rows.push(`<div class="tl-row"><span class="tl-label">t</span><div class="tl-cells">${cells}</div></div>`);

    // 没走成的按键显示为灰色空心箭头（miss）；
    // 影子录制时没走成、这一轮却走成了的按键变实心（revived），刚发生的那一格闪一下（just）
    cells = '';
    for (let i = 0; i < L.maxSteps; i++) {
      const a = game.script[i];
      const miss = a && game.scriptOk[i] === false;
      cells += `<div class="tlc ${a ? 'has' : ''} ${miss ? 'miss' : ''} ${i === game.t ? 'cur' : ''} ${i < game.t ? 'past' : ''}">${a ? ARROW[a] : ''}</div>`;
    }
    rows.push(`<div class="tl-row"><span class="tl-label">你</span><div class="tl-cells">${cells}</div></div>`);

    game.shadows.forEach((s, idx) => {
      cells = '';
      for (let i = 0; i < L.maxSteps; i++) {
        const a = s.script[i];
        const done = i >= s.script.length;
        const miss = a && s.scriptOk[i] === false;
        const revived = miss && i < game.t && s.liveOk[i] === true;
        const just = revived && i === game.t - 1 && this.justRevived.includes(idx);
        const cls = revived ? 'revived' + (just ? ' just' : '') : (miss ? 'miss' : '');
        cells += `<div class="tlc ${a ? 'has' : ''} ${cls} ${i === game.t ? 'cur' : ''} ${i < game.t && !revived ? 'past' : ''} ${done ? 'done' : ''}">${a ? ARROW[a] : '·'}</div>`;
      }
      rows.push(`<div class="tl-row"><span class="tl-label">影${idx + 1}</span><div class="tl-cells">${cells}</div></div>`);
    });
    this.timelineEl.innerHTML = rows.join('');
    this.timelineEl.classList.toggle('long', this.longTimeline);
    if (this.longTimeline) this.scrollTimelineToCur();
  }

  // 长关卡：自动滚动，让当前步保持在时间轴中间附近
  scrollTimelineToCur() {
    const cur = this.timelineEl.querySelector('.tlc.cur');
    if (!cur) return;
    const tlRect = this.timelineEl.getBoundingClientRect();
    const curRect = cur.getBoundingClientRect();
    this.timelineEl.scrollLeft += curRect.left + curRect.width / 2 - (tlRect.left + this.timelineEl.clientWidth / 2);
  }

  updateHeader(game) {
    this.screen.querySelector('#round-label').textContent = `第 ${game.round} 轮`;
    this.screen.querySelector('#steps-label').textContent = `${game.t}/${this.level.maxSteps}`;
    const shadowLabel = this.screen.querySelector('#shadow-label');
    shadowLabel.textContent = `影子 ${game.shadowCount}/${this.level.maxShadows}`;
    shadowLabel.hidden = this.level.maxShadows === 0;
  }

  // ---- 提示（三级：提示 1 → 提示 2 → 自动演示）----

  updateHint() {
    const shown = this.level.hints.slice(0, this.hintLevel);
    this.hintBox.classList.toggle('hidden', shown.length === 0);
    this.hintText.textContent = shown.map((h, i) => `${i + 1}. ${h}`).join('\n');
  }

  setHintLevel(n) {
    this.hintLevel = n;
    this.updateHint();
    this.updateButtons(this.game);
  }

  setDemo(on) {
    this.demo = on;
    if (!on) this._stopRewindAnim();
    if (on) this.hideGuide();
    this.updateStatus(this.game);
    this.updateButtons(this.game);
  }

  updateStatus(game) {
    let text = '';
    if (this.demo) text = '演示中 · 点击地图或按任意键跳过';
    else if (game.won) text = '通关！';
    else if (!game.canMove) text = '本轮步数已用完：回溯 / 撤销 / 重开';
    this.statusEl.textContent = text;
  }

  // ---- 新手引导气泡 ----

  showGuide(text, { pulse = null } = {}) {
    this.guideEl.textContent = text;
    this.guideEl.classList.add('show');
    for (const [act, btn] of this.btns) btn.classList.toggle('pulse', act === pulse);
  }

  hideGuide() {
    this.guideEl.classList.remove('show');
    for (const btn of this.btns.values()) btn.classList.remove('pulse');
  }

  updateButtons(game) {
    const wait = this.btns.get('wait');
    if (wait) wait.disabled = !game.canMove;
    const rewind = this.btns.get('rewind');
    if (rewind) {
      rewind.hidden = this.level.maxShadows === 0;
      rewind.disabled = !game.canRewind;
      rewind.title = game.canRewind ? '' : (game.won ? '已通关' : '影子已满，无法回溯');
    }
    const undo = this.btns.get('undo');
    if (undo) undo.disabled = !game.canUndo;
    const hint = this.btns.get('hint');
    if (hint) hint.textContent = this.hintLevel >= 2 ? '看演示' : (this.hintLevel === 1 ? '提示 2' : '提示');
  }

  // ---- 操作反馈（5.4）----

  onStep(res, game) {
    this.justRevived = res.revived ?? [];
    this.sync(game, { snap: false });
    this.justRevived = [];
    for (const f of res.failed) {
      const el = f.isPlayer ? this.playerEl : this.shadowEls[f.index];
      if (el) this.bump(el, f.dir);
    }
    for (const i of res.blockedShadows) this.blockedFlash(i);
    for (const i of res.revived ?? []) this.revivedFlash(i); // 盲按生效那一刻闪一下，和时间轴呼应
  }

  revivedFlash(i) {
    const el = this.shadowEls[i];
    if (!el) return;
    el.classList.remove('revived');
    void el.offsetWidth;
    el.classList.add('revived');
    clearTimeout(el._revTimer);
    el._revTimer = setTimeout(() => el.classList.remove('revived'), 850);
  }

  bump(el, dir) {
    const body = el.querySelector('.body');
    body.classList.remove('bump-U', 'bump-D', 'bump-L', 'bump-R');
    void body.offsetWidth;
    body.classList.add('bump-' + dir);
    setTimeout(() => body.classList.remove('bump-' + dir), 260);
  }

  blockedFlash(i) {
    const el = this.shadowEls[i];
    if (!el) return;
    el.classList.remove('blocked');
    void el.offsetWidth;
    el.classList.add('blocked');
    const badge = el.querySelector('.badge');
    badge.classList.add('show');
    this._clearBadgeTimer(el);
    el._badgeTimer = setTimeout(() => {
      badge.classList.remove('show');
      el.classList.remove('blocked');
    }, 900);
  }

  _clearBadgeTimer(el) {
    if (el && el._badgeTimer) {
      clearTimeout(el._badgeTimer);
      el._badgeTimer = null;
    }
  }

  // 倒带动画（5.4）：本轮的玩家沿走过的路线快速倒退回起点（约 0.5 秒），
  // 然后所有角色出现在起点，再显示"第 N 轮"
  onRewind(res, game) {
    this._stopRewindAnim();
    this.sync(game, { snap: true });
    const pts = [];
    for (const p of [...(res.path ?? [])].reverse()) {
      const last = pts[pts.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) pts.push(p);
    }
    if (pts.length < 2) {
      this.rewindFx(res.round);
      return;
    }
    const per = Math.max(30, Math.min(110, Math.round(500 / (pts.length - 1))));
    const ghost = this.makeEntity('player ghost');
    this.positionEntity(ghost, pts[0], true);
    ghost.style.transition = `transform ${per}ms linear`;
    this.entitiesLayer.appendChild(ghost);
    this.mapEl.classList.add('rewinding');
    this.rwGhost = ghost;
    let i = 1;
    const tick = () => {
      if (i < pts.length) {
        const p = pts[i++];
        ghost.style.transform = `translate(${p.x * this.cell}px, ${p.y * this.cell}px)`;
        this.rwTimer = setTimeout(tick, per);
        return;
      }
      this._stopRewindAnim();
      for (const el of [this.playerEl, ...this.shadowEls]) {
        el.classList.remove('appear');
        void el.offsetWidth;
        el.classList.add('appear');
      }
      this.rewindFx(res.round);
    };
    this.rwTimer = setTimeout(tick, 60);
  }

  _stopRewindAnim() {
    clearTimeout(this.rwTimer);
    this.rwTimer = null;
    if (this.rwGhost) this.rwGhost.remove();
    this.rwGhost = null;
    this.mapEl.classList.remove('rewinding');
  }

  rewindFx(round) {
    const fx = document.getElementById('fx-rewind');
    fx.querySelector('.label').textContent = `第 ${round} 轮`;
    fx.classList.remove('play');
    void fx.offsetWidth;
    fx.classList.add('play');
    setTimeout(() => fx.classList.remove('play'), 1000);
  }

  // ---- 通关 ----
  // title：默认「通关！」；章末关卡传「第 N 章完成」
  // optimal：最后一轮步数 ≤ par 时显示「最优解！」
  winFx({ title = '通关！', shadows, steps, optimal = false, hasNext, onNext, onReplay, onSelect }) {
    setTimeout(() => {
      const fx = document.getElementById('fx-win');
      fx.querySelector('h2').textContent = title;
      fx.querySelector('.win-ending').hidden = true;
      fx.querySelector('.win-stats').textContent = `用了 ${shadows} 个影子 · 总步数 ${steps}`;
      fx.querySelector('.win-sub').hidden = true;
      fx.querySelector('.win-par').hidden = !optimal;
      this.buildWinActions(fx, [
        hasNext && ['下一关', onNext, true],
        [hasNext ? '重玩本关' : '再玩一次', onReplay, !hasNext],
        ['选关', onSelect, false],
      ]);
      this.confetti(fx);
      fx.classList.add('show');
    }, 380);
  }

  // 第 50 关通关后的结尾画面：一句收尾的话、总通关数、总用时
  endFx({ shadows, steps, optimal = false, clearedCount, totalText, onReplay, onSelect }) {
    setTimeout(() => {
      const fx = document.getElementById('fx-win');
      fx.querySelector('h2').textContent = '全部通关！';
      const ending = fx.querySelector('.win-ending');
      ending.hidden = false;
      ending.textContent = '你和过去的每一个自己，都走到了终点。';
      fx.querySelector('.win-stats').textContent = `通关 ${clearedCount}/${this.level.id} · 总用时 ${totalText}`;
      const sub = fx.querySelector('.win-sub');
      sub.hidden = false;
      sub.textContent = `最后一关：用了 ${shadows} 个影子 · 总步数 ${steps}`;
      fx.querySelector('.win-par').hidden = !optimal;
      this.buildWinActions(fx, [
        ['回到选关', onSelect, true],
        ['再玩一次', onReplay, false],
      ]);
      this.confetti(fx);
      fx.classList.add('show');
    }, 380);
  }

  buildWinActions(fx, list) {
    const actions = fx.querySelector('.win-actions');
    actions.innerHTML = '';
    for (const item of list) {
      if (!item) continue;
      const [label, fn, primary] = item;
      const b = document.createElement('button');
      b.textContent = label;
      if (primary) b.classList.add('primary');
      b.addEventListener('click', fn);
      actions.appendChild(b);
    }
  }

  confetti(fx) {
    const holder = fx.querySelector('.confetti');
    holder.innerHTML = '';
    const colors = ['#e05e5e', '#4d9de0', '#e0a34d', '#58b577', '#b59ade', '#f4f2ec'];
    for (let i = 0; i < 36; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = Math.random() * 0.5 + 's';
      piece.style.animationDuration = 1.1 + Math.random() * 0.9 + 's';
      piece.style.width = 5 + Math.random() * 5 + 'px';
      piece.style.height = 8 + Math.random() * 8 + 'px';
      holder.appendChild(piece);
    }
    setTimeout(() => { holder.innerHTML = ''; }, 2600);
  }
}
