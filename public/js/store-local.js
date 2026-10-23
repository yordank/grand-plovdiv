// Демо без сървър (GitHub Pages): данните се пазят само в този браузър
(function () {
  const C = window.GrandCalc;
  const KEY = 'grand-demo-v1';
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  let mem = null;

  const clone = (x) => JSON.parse(JSON.stringify(x));
  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { mem = null; }
    if (!mem) mem = { objects: clone(window.GRAND_OBJECTS || []), months: {} };
    return mem;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* само в паметта */ } }
  function fail(msg, status) { const e = new Error(msg); e.status = status; throw e; }
  const check = (id) => { if (!MONTH_RE.test(id)) fail('Месецът трябва да е във вид ГГГГ-ММ.', 400); };
  const items = (arr) => (Array.isArray(arr) ? arr : [])
    .map((it) => ({ name: String(it && it.name || '').slice(0, 200), amount: Number(it && it.amount) || 0 }))
    .filter((it) => it.name || it.amount);
  function clean(m) {
    const mode = ['full', 'partial', 'none'].includes(m.deductMode) ? m.deductMode : 'full';
    return {
      fixedItems: items(m.fixedItems), water: Number(m.water) || 0, power: Number(m.power) || 0,
      chillers: Number(m.chillers) || 0, revenueItems: items(m.revenueItems), deductMode: mode,
      deductPct: mode === 'partial' ? Math.min(Math.max(Number(m.deductPct) || 0, 0), 100) : mode === 'full' ? 100 : 0,
      deductReason: String(m.deductReason || '').slice(0, 100), note: String(m.note || '').slice(0, 2000),
    };
  }

  window.GrandStore = {
    mode: 'local',
    async init() { load(); return { signedIn: true, canEdit: true, user: 'Демо' }; },
    async getObjects() { return clone(load().objects); },
    async saveObjects(list) { load().objects = clone(list); save(); return clone(list); },
    async listMonths() { return Object.values(load().months).map(clone).sort((a, b) => b.id.localeCompare(a.id)); },
    async getMonth(id) { check(id); const m = load().months[id]; return m ? clone(m) : null; },
    async saveMonth(id, data) {
      check(id);
      const cur = load().months[id];
      if (cur && cur.status === 'locked') fail('Месецът е заключен. Отключи го, за да го промениш.', 409);
      const doc = { ...clean(data), id, status: 'draft', snapshot: null, updatedAt: new Date().toISOString(), lockedAt: null };
      mem.months[id] = doc; save(); return clone(doc);
    },
    async lockMonth(id, objects) {
      check(id);
      const cur = load().months[id];
      if (!cur) fail('Няма такъв месец.', 404);
      if (cur.status === 'locked') fail('Месецът вече е заключен.', 409);
      const result = C.calculate(objects, C.monthInput(cur));
      if (!result.balanced) fail('Сметките не се връзват: ' + (result.warnings.join(' ') || 'сборът не съвпада.'), 422);
      const now = new Date().toISOString();
      const doc = { ...clean(cur), id, status: 'locked', snapshot: C.snapshotOf(objects, result), updatedAt: now, lockedAt: now };
      mem.months[id] = doc; save(); return clone(doc);
    },
    async unlockMonth(id) {
      check(id);
      const cur = load().months[id];
      if (!cur) fail('Няма такъв месец.', 404);
      const doc = { ...clean(cur), id, status: 'draft', snapshot: null, updatedAt: new Date().toISOString(), lockedAt: null };
      mem.months[id] = doc; save(); return clone(doc);
    },
    async deleteMonth(id) {
      check(id);
      const cur = load().months[id];
      if (cur && cur.status === 'locked') fail('Само чернова може да се изтрие.', 409);
      delete mem.months[id]; save(); return { ok: true };
    },
    async download(filename, blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return true;
    },
  };
})();
