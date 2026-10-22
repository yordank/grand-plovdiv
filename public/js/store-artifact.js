// Данни в claude.ai (страница с линк): база `db`, кой гледа — `user`, сваляне — `downloads`
(function () {
  const C = window.GrandCalc;
  let db = null, user = null, downloads = null;
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

  const clone = (x) => JSON.parse(JSON.stringify(x));
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

  function fail(msg, status) { const e = new Error(msg); e.status = status; throw e; }
  function dbError(e) {
    const code = e && e.code;
    if (code === 'invalid_argument') fail('Нямаш права да променяш данните или данните са твърде големи.', 403);
    if (code === 'quota_exceeded') fail('Мястото за данни е запълнено.', 507);
    fail('Връзката с данните прекъсна. Опитай отново.', 503);
  }
  async function guard(p) { try { return await p; } catch (e) { if (e && e.status) throw e; dbError(e); } }

  const monthRef = (id) => { if (!MONTH_RE.test(id)) fail('Месецът трябва да е във вид ГГГГ-ММ.', 400); return db.doc('months/' + id); };
  const fromDoc = (snap) => (snap && snap.exists ? { ...clone(snap.data()), id: snap.id } : null);

  window.GrandStore = {
    mode: 'artifact',
    async init() {
      if (!window.claude || !window.claude.use) return { signedIn: false, reason: 'Страницата трябва да се отвори в claude.ai.' };
      [db, user, downloads] = await Promise.all([
        window.claude.use('db'), window.claude.use('user'), window.claude.use('downloads'),
      ]);
      if (!db) return { signedIn: false, reason: 'Влез в claude.ai, за да видиш данните.' };
      let canEdit = false;
      try { canEdit = user ? await user.canEdit() : false; } catch { canEdit = false; }
      let name = '';
      try { const me = user && (await user.me()); name = (me && me.name) || ''; } catch { /* без име */ }
      return { signedIn: true, canEdit, user: name };
    },
    async getObjects() {
      const s = await guard(db.doc('config/objects').get());
      return s.exists ? clone(s.data().list || []) : null;
    },
    async saveObjects(list) {
      await guard(db.doc('config/objects').set({ list: clone(list), updatedAt: new Date().toISOString() }));
      return clone(list);
    },
    async listMonths() {
      const s = await guard(db.collection('months').get());
      return s.docs.map(fromDoc).filter(Boolean).sort((a, b) => b.id.localeCompare(a.id));
    },
    async getMonth(id) { return fromDoc(await guard(monthRef(id).get())); },
    async saveMonth(id, data) {
      const ref = monthRef(id);
      const cur = fromDoc(await guard(ref.get()));
      if (cur && cur.status === 'locked') fail('Месецът е заключен. Отключи го, за да го промениш.', 409);
      const doc = { ...clean(data), status: 'draft', snapshot: null, updatedAt: new Date().toISOString(), lockedAt: null };
      await guard(ref.set(doc));
      return { ...doc, id };
    },
    async lockMonth(id, objects) {
      const ref = monthRef(id);
      const cur = fromDoc(await guard(ref.get()));
      if (!cur) fail('Няма такъв месец.', 404);
      if (cur.status === 'locked') fail('Месецът вече е заключен.', 409);
      const result = C.calculate(objects, C.monthInput(cur));
      if (!result.balanced) fail('Сметките не се връзват: ' + (result.warnings.join(' ') || 'сборът не съвпада.'), 422);
      const now = new Date().toISOString();
      const doc = { ...clean(cur), status: 'locked', snapshot: C.snapshotOf(objects, result), updatedAt: now, lockedAt: now };
      await guard(ref.set(doc));
      return { ...doc, id };
    },
    async unlockMonth(id) {
      const ref = monthRef(id);
      const cur = fromDoc(await guard(ref.get()));
      if (!cur) fail('Няма такъв месец.', 404);
      const doc = { ...clean(cur), status: 'draft', snapshot: null, updatedAt: new Date().toISOString(), lockedAt: null };
      await guard(ref.set(doc));
      return { ...doc, id };
    },
    async deleteMonth(id) {
      const ref = monthRef(id);
      const cur = fromDoc(await guard(ref.get()));
      if (cur && cur.status === 'locked') fail('Само чернова може да се изтрие.', 409);
      await guard(ref.delete());
      return { ok: true };
    },
    async download(filename, blob) {
      if (!downloads) fail('Свалянето не е достъпно тук.', 501);
      try {
        await downloads.save({ filename, data: blob });
        return true;
      } catch (e) {
        if (e && e.code === 'declined') return false;
        if (e && e.code === 'rate_limited') fail('Изчакай малко и опитай отново.', 429);
        fail('Файлът не можа да се свали.', 500);
      }
    },
    scriptBase: null,
  };
})();
