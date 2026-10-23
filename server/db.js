// Данните се пазят в един JSON файл (без компилирани библиотеки — тръгва на всеки хостинг).
// Записът е атомарен: първо във временен файл, после преименуване.
const fs = require('fs');
const path = require('path');

const SEED = path.join(__dirname, '..', 'data', 'objects.json');
const clone = (x) => JSON.parse(JSON.stringify(x));

function open(file) {
  const db = { file, data: { objects: [], months: {}, settings: {} } };
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      db.data = { objects: [], months: {}, settings: {}, ...parsed };
    }
  }
  if (!db.data.objects.length && fs.existsSync(SEED)) {
    db.data.objects = normalizeObjects(JSON.parse(fs.readFileSync(SEED, 'utf8')));
    persist(db);
  }
  return db;
}

function persist(db) {
  if (db.file === ':memory:') return;
  const tmp = `${db.file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db.data));
  fs.renameSync(tmp, db.file);
}

function normalizeObjects(list) {
  return list.map((o) => ({
    id: String(o.id).trim(),
    share: Number(o.share) || 0,
    kind: o.kind || 'unit',
    floor: o.floor === null || o.floor === undefined || o.floor === '' || isNaN(Number(o.floor)) ? null : Number(o.floor),
    fixed: !!o.fixed, water: !!o.water, power: !!o.power, chillers: !!o.chillers,
    note: String(o.note || ''),
  }));
}

function getObjects(db) {
  return clone(db.data.objects);
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
  db.data.objects = normalizeObjects(list);
  persist(db);
}

function listMonths(db) {
  return Object.values(db.data.months).map(clone).sort((a, b) => b.id.localeCompare(a.id));
}

function getMonth(db, id) {
  const m = db.data.months[id];
  return m ? clone(m) : null;
}

// Само въведените данни се приемат от клиента; статусът и снимката се определят от сървъра.
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
  const cur = db.data.months[id];
  db.data.months[id] = {
    ...cleanMonthData(data), id,
    status: cur ? cur.status : 'draft',
    snapshot: cur ? cur.snapshot : null,
    updatedAt: new Date().toISOString(),
    lockedAt: cur ? cur.lockedAt : null,
  };
  persist(db);
  return getMonth(db, id);
}

function lockMonth(db, id, snapshot) {
  const now = new Date().toISOString();
  Object.assign(db.data.months[id], { status: 'locked', snapshot, lockedAt: now, updatedAt: now });
  persist(db);
  return getMonth(db, id);
}

function unlockMonth(db, id) {
  Object.assign(db.data.months[id], { status: 'draft', snapshot: null, lockedAt: null, updatedAt: new Date().toISOString() });
  persist(db);
  return getMonth(db, id);
}

function deleteMonth(db, id) {
  const m = db.data.months[id];
  if (!m || m.status !== 'draft') return 0;
  delete db.data.months[id];
  persist(db);
  return 1;
}

function getSetting(db, key) {
  return key in db.data.settings ? db.data.settings[key] : null;
}
function setSetting(db, key, value) {
  if (db.data.settings[key] === value) return;
  db.data.settings[key] = value;
  persist(db);
}

module.exports = {
  open, getObjects, validateObjects, replaceObjects,
  listMonths, getMonth, saveMonth, lockMonth, unlockMonth, deleteMonth, cleanMonthData,
  getSetting, setSetting,
};
