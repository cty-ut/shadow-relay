// src/telemetry.js —— 试玩数据记录（需求文档第 6 节）

const RECORDS_KEY = 'shadowRelay.telemetry.v1';
const PROGRESS_KEY = 'shadowRelay.progress.v1';

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let active = null;

export function startLevel(levelId) {
  active = {
    levelId,
    startTime: new Date().toISOString(),
    _startMs: Date.now(),
    endTime: null,
    cleared: false,
    moves: 0,
    rewinds: 0,
    undos: 0,
    restarts: 0,
    hintLevel: 0,
    firstInputDelay: null,
    quitAt: null,
    _firstInputMs: null,
  };
}

export function hasActive() { return active !== null; }

export function markInput() {
  if (active && active._firstInputMs === null) active._firstInputMs = Date.now();
}
export function countMove() { if (active) active.moves++; }
export function countRewind() { if (active) active.rewinds++; }
export function countUndo() { if (active) active.undos++; }
export function countRestart() { if (active) active.restarts++; }
export function markHint(level) { if (active) active.hintLevel = Math.max(active.hintLevel, level); }

export function endLevel(cleared, quitAt = null) {
  if (!active) return null;
  active.endTime = new Date().toISOString();
  active.cleared = !!cleared;
  if (active._firstInputMs !== null) {
    active.firstInputDelay = Math.round((active._firstInputMs - active._startMs) / 100) / 10;
  }
  if (!active.cleared && quitAt) active.quitAt = { t: quitAt.t, round: quitAt.round };
  const rec = { ...active };
  delete rec._startMs;
  delete rec._firstInputMs;
  const records = lsGet(RECORDS_KEY, []);
  records.push(rec);
  lsSet(RECORDS_KEY, records);
  active = null;
  return rec;
}

export function getRecords() { return lsGet(RECORDS_KEY, []); }

export function isCleared(levelId) {
  return !!lsGet(PROGRESS_KEY, {})[levelId];
}

export function markCleared(levelId) {
  const p = lsGet(PROGRESS_KEY, {});
  p[levelId] = true;
  lsSet(PROGRESS_KEY, p);
}

export function clearAll() {
  try {
    localStorage.removeItem(RECORDS_KEY);
    localStorage.removeItem(PROGRESS_KEY);
  } catch { /* 忽略 */ }
}

export function buildExport() {
  return JSON.stringify({
    game: '影子接力',
    milestone: 'M1.1',
    exportedAt: new Date().toISOString(),
    records: getRecords(),
  }, null, 2);
}

export function downloadExport() {
  try {
    const blob = new Blob([buildExport()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shadow-relay-试玩数据-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

export async function copyExport() {
  const text = buildExport();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 降级 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
