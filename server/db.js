const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SEED = path.join(__dirname, '..', 'data', 'objects.json');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS objects (
      pos       INTEGER NOT NULL,
      id        TEXT PRIMARY KEY,
      share     REAL NOT NULL DEFAULT 0,
      kind      TEXT NOT NULL DEFAULT 'unit',
      floor     INTEGER,
      fixed     INTEGER NOT NULL DEFAULT 1,
      water     INTEGER NOT NULL DEFAULT 1,
      power     INTEGER NOT NULL DEFAULT 1,
      chillers  INTEGER NOT NULL DEFAULT 0,
      note      TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS months (
      id         TEXT PRIMARY KEY,           -- 'YYYY-MM'
      status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked')),
      data       TEXT NOT NULL,              -- JSON: разходи, приходи, чл. 10, бележка
      snapshot   TEXT,                       -- JSON: обекти и сметки при заключване
      updated_at TEXT NOT NULL,
      locked_at  TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const count = db.prepare('SELECT COUNT(*) AS n FROM objects').get().n;
  if (count === 0 && fs.existsSync(SEED)) replaceObjects(db, JSON.parse(fs.readFileSync(SEED, 'utf8')));
  return db;
}

function rowToObject(r) {
  return {
    id: r.id, share: r.share, kind: r.kind, floor: r.floor,
    fixed: !!r.fixed, water: !!r.water, power: !!r.power, chillers: !!r.chillers,
    note: r.note || '',
  };
}

function getObjects(db) {
  return db.prepare('SELECT * FROM objects ORDER BY pos').all().map(rowToObject);
}

const KINDS = new Set(['unit', 'terrace', 'garage', 'hypermarket']);

function validateObjects(list) {
  if (!Array.isArray(list) || list.length === 0) return 'Списъкът с обекти е празен.';
  const seen = new Set();
  for (const o of list) {
    const id = String(o && o.id || '').trim();
    if (!id) return 'Има обект без номер.';
    if (seen.has(id)) return `Обект „${id}“ се повтаря.`;
    seen.add(id);
    const s = Number(o.share);
    if (!Number.isFinite(s) || s < 0 || s > 100) return `Невалидна идеална част при „${id}“.`;
    if (!KINDS.has(o.kind || 'unit')) return `Невалиден вид при „${id}“.`;
  }
  return null;
}

function replaceObjects(db, list) {
  const ins = db.prepare(`INSERT INTO objects (pos,id,share,kind,floor,fixed,water,power,chillers,note)
    VALUES (@pos,@id,@share,@kind,@floor,@fixed,@water,@power,@chillers,@note)`);
  db.transaction(() => {
    db.prepare('DELETE FROM objects').run();
    list.forEach((o, i) => ins.run({
      pos: i, id: String(o.id).trim(), share: Number(o.share) || 0, kind: o.kind || 'unit',
      floor: o.floor === null || o.floor === undefined || o.floor === '' ? null : Number(o.floor),
      fixed: o.fixed ? 1 : 0, water: o.water ? 1 : 0, power: o.power ? 1 : 0, chillers: o.chillers ? 1 : 0,
      note: String(o.note || ''),
    }));
  })();
}

function rowToMonth(r) {
  if (!r) return null;
  return {
    ...JSON.parse(r.data),
    id: r.id, status: r.status, updatedAt: r.updated_at, lockedAt: r.locked_at,
    snapshot: r.snapshot ? JSON.parse(r.snapshot) : null,
  };
}

function listMonths(db) {
  return db.prepare('SELECT * FROM months ORDER BY id DESC').all().map(rowToMonth);
}

function getMonth(db, id) {
  return rowToMonth(db.prepare('SELECT * FROM months WHERE id = ?').get(id));
}

// Само въведените данни се пазят в `data`; статусът и снимката са отделно.
function cleanMonthData(m) {
  const items = (arr) => (Array.isArray(arr) ? arr : [])
    .map((it) => ({ name: String(it && it.name || '').slice(0, 200), amount: Number(it && it.amount) || 0 }))
    .filter((it) => it.name || it.amount);
  const mode = ['full', 'partial', 'none'].includes(m.deductMode) ? m.deductMode : 'full';
  return {
    fixedItems: items(m.fixedItems),
    water: Number(m.water) || 0,
    power: Number(m.power) || 0,
    chillers: Number(m.chillers) || 0,
    revenueItems: items(m.revenueItems),
    deductMode: mode,
    deductPct: mode === 'partial' ? Math.min(Math.max(Number(m.deductPct) || 0, 0), 100) : mode === 'full' ? 100 : 0,
    deductReason: String(m.deductReason || '').slice(0, 100),
    note: String(m.note || '').slice(0, 2000),
  };
}

function saveMonth(db, id, data) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO months (id,status,data,updated_at) VALUES (?, 'draft', ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .run(id, JSON.stringify(cleanMonthData(data)), now);
  return getMonth(db, id);
}

function lockMonth(db, id, snapshot) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE months SET status='locked', snapshot=?, locked_at=?, updated_at=? WHERE id=?`)
    .run(JSON.stringify(snapshot), now, now, id);
  return getMonth(db, id);
}

function unlockMonth(db, id) {
  db.prepare(`UPDATE months SET status='draft', snapshot=NULL, locked_at=NULL, updated_at=? WHERE id=?`)
    .run(new Date().toISOString(), id);
  return getMonth(db, id);
}

function deleteMonth(db, id) {
  return db.prepare(`DELETE FROM months WHERE id=? AND status='draft'`).run(id).changes;
}

function getSetting(db, key) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : null;
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

module.exports = {
  open, getObjects, validateObjects, replaceObjects,
  listMonths, getMonth, saveMonth, lockMonth, unlockMonth, deleteMonth, cleanMonthData,
  getSetting, setSetting,
};
