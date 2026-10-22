// Excel: експорт на месец и обекти, импорт на списъка с обекти
(function (root) {
  const KIND_BG = { unit: 'обект', terrace: 'тераса', garage: 'гараж', hypermarket: 'хипермаркет' };
  const KIND_FROM = { 'обект': 'unit', 'тераса': 'terrace', 'гараж': 'garage', 'хипермаркет': 'hypermarket' };
  const PARTS = ['fixed', 'water', 'power', 'chillers'];
  const PART_HEAD = { fixed: 'Постоянни', water: 'Вода', power: 'Ток общи', chillers: 'Чилъри' };
  const yes = (v) => /^(да|1|true|x|✓)$/i.test(String(v == null ? '' : v).trim());
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

  const lib = () => root.XLSX;
  const load = () => (root.GrandLibs ? root.GrandLibs.load('xlsx') : Promise.resolve());

  function toBlob(wb) {
    const out = lib().write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  async function exportMonth(ctx) {
    await load();
    const X = lib(), C = root.GrandCalc, F = root.GrandFmt;
    const r = ctx.result, m = ctx.month;
    const head = ['Обект', 'Идеална част %', 'Вид', 'Етаж', 'Постоянни €', 'Вода €', 'Ток общи €', 'Чилъри €', 'Общо €'];
    const rows = r.rows.map((x) => [x.id, x.share, KIND_BG[x.kind] || x.kind, x.floor == null ? '' : x.floor,
      r2(x.parts.fixed), r2(x.parts.water), r2(x.parts.power), r2(x.parts.chillers), r2(x.total)]);
    const n = rows.length;
    rows.push(['ОБЩО', { f: `SUM(B2:B${n + 1})` }, '', '',
      { f: `SUM(E2:E${n + 1})` }, { f: `SUM(F2:F${n + 1})` }, { f: `SUM(G2:G${n + 1})` }, { f: `SUM(H2:H${n + 1})` }, { f: `SUM(I2:I${n + 1})` }]);
    const ws = X.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = [{ wch: 18 }, { wch: 13 }, { wch: 12 }, { wch: 6 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    ws['!autofilter'] = { ref: `A1:I${n + 1}` };

    const S = [
      [`ТАЦ „Гранд“ — справка за ${F.monthName(ctx.monthId)}`],
      [ctx.locked ? 'Заключен месец' : 'Чернова'],
      [],
      ['Разходи', 'Сума €'],
      ...(m.fixedItems || []).filter((it) => Number(it.amount)).map((it) => ['  ' + it.name, r2(it.amount)]),
      ['Постоянни текущи разходи — общо', r2(C.sumItems(m.fixedItems))],
      ['Вода за общите части', r2(m.water)],
      ['Електроенергия за общите части', r2(m.power)],
      ['Електроенергия за чилърите', r2(m.chillers)],
      [],
      ['Приходи', 'Сума €'],
      ...(m.revenueItems || []).filter((it) => Number(it.amount)).map((it) => ['  ' + it.name, r2(it.amount)]),
      ['Приходи — общо', r2(C.sumItems(m.revenueItems))],
      ['Приспаднати (чл. 10)', r2(r.deducted)],
      [],
      ['Разпределение', 'Сума €', 'База'],
      ['Постоянни (поравно)', r2(r.pools.fixed), `${r.bases.fixed} обекта`],
      ['Вода (поравно)', r2(r.pools.water), `${r.bases.water} обекта`],
      ['Ток общи (ид. части)', r2(r.pools.power), `${r.bases.power}%`],
      ['Чилъри (ид. части)', r2(r.pools.chillers), `${r.bases.chillers}%`],
      ['За разпределяне', r2(r.totalPool), `${r.payers} обекта`],
    ];
    if (m.note) S.push([], ['Бележка', m.note]);
    const ws2 = X.utils.aoa_to_sheet(S);
    ws2['!cols'] = [{ wch: 38 }, { wch: 14 }, { wch: 16 }];

    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws2, 'Справка');
    X.utils.book_append_sheet(wb, ws, 'Сметки');
    return toBlob(wb);
  }

  async function exportObjects(objects) {
    await load();
    const X = lib();
    const head = ['Обект', 'Идеална част %', 'Вид', 'Етаж', ...PARTS.map((p) => PART_HEAD[p]), 'Бележка'];
    const rows = objects.map((o) => [o.id, o.share, KIND_BG[o.kind] || o.kind, o.floor == null ? '' : o.floor,
      ...PARTS.map((p) => (o[p] ? 'да' : 'не')), o.note || '']);
    const ws = X.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = [{ wch: 18 }, { wch: 13 }, { wch: 12 }, { wch: 6 }, { wch: 10 }, { wch: 8 }, { wch: 9 }, { wch: 8 }, { wch: 30 }];
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Обекти');
    return toBlob(wb);
  }

  // Чете Excel със списък на обекти. Търси ред със заглавия „обект“ и „част“.
  // Ако има колони Вид/Етаж/Постоянни/Вода/Ток общи/Чилъри/Бележка, взима и тях.
  function parseObjectsWorkbook(wb) {
    const X = lib();
    for (const name of wb.SheetNames) {
      const aoa = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      const norm = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
      const hi = aoa.findIndex((row) => row && row.some((c) => /обект/.test(norm(c))) && row.some((c) => /част/.test(norm(c))));
      if (hi < 0) continue;
      const H = aoa[hi].map(norm);
      const col = (re) => H.findIndex((h) => re.test(h));
      const ci = {
        id: col(/обект/), share: col(/част/), kind: col(/^вид/), floor: col(/^етаж/),
        fixed: col(/^постоянни/), water: col(/^вода/), power: col(/^ток общи/), chillers: col(/^чил/), note: col(/^бележка/),
      };
      const out = [], skipped = [];
      for (let i = hi + 1; i < aoa.length; i++) {
        const row = aoa[i] || [];
        const id = row[ci.id] == null ? '' : String(row[ci.id]).trim();
        const rawShare = row[ci.share];
        if (!id && (rawShare == null || rawShare === '')) continue;
        const share = typeof rawShare === 'number' ? rawShare : Number(String(rawShare || '').replace(',', '.'));
        if (!id || /^общо$/i.test(id) || !Number.isFinite(share)) { skipped.push(i + 1); continue; }
        const o = { id, share };
        if (ci.kind >= 0 && KIND_FROM[norm(row[ci.kind])]) o.kind = KIND_FROM[norm(row[ci.kind])];
        if (ci.floor >= 0) { const f = row[ci.floor]; o.floor = f === null || f === '' || isNaN(Number(f)) ? null : Number(f); }
        for (const p of PARTS) if (ci[p] >= 0) o[p] = yes(row[ci[p]]);
        if (ci.note >= 0) o.note = row[ci.note] == null ? '' : String(row[ci.note]);
        out.push(o);
      }
      if (out.length) return { sheet: name, rows: out, skipped, hasFlags: ci.fixed >= 0 };
    }
    throw new Error('Не намерих колони „обект“ и „идеална част“ в този файл.');
  }

  async function parseObjectsFile(file) {
    await load();
    const buf = await file.arrayBuffer();
    return parseObjectsWorkbook(lib().read(buf, { type: 'array' }));
  }

  // Сравнява внесения списък с текущия
  function diffObjects(current, incoming) {
    const cur = new Map(current.map((o) => [o.id, o]));
    const inc = new Map(incoming.map((o) => [o.id, o]));
    const changed = [], added = [], missing = [];
    for (const o of incoming) {
      const c = cur.get(o.id);
      if (!c) added.push(o);
      else if (Math.abs(c.share - o.share) > 1e-9 || PARTS.some((p) => p in o && !!o[p] !== !!c[p]) || ('kind' in o && o.kind !== c.kind)) changed.push({ from: c, to: o });
    }
    for (const c of current) if (!inc.has(c.id)) missing.push(c);
    return { changed, added, missing };
  }

  // Прилага внесения списък: пази отметките на познатите обекти, новите получават правилата по подразбиране
  function applyImport(current, incoming, removeMissing) {
    const cur = new Map(current.map((o) => [o.id, o]));
    const defaults = (o) => {
      const m = /^([1-4])-/.exec(o.id);
      const kind = o.kind || (/тераса/i.test(o.id) ? 'terrace' : 'unit');
      const floor = 'floor' in o ? o.floor : m ? Number(m[1]) : null;
      return {
        kind, floor,
        fixed: kind !== 'terrace', water: !['terrace', 'garage', 'hypermarket'].includes(kind),
        power: kind !== 'terrace', chillers: kind === 'unit' && [1, 2, 3].includes(floor),
        note: 'нов обект — провери отметките',
      };
    };
    const result = incoming.map((o) => ({ ...(cur.get(o.id) || { id: o.id, ...defaults(o) }), ...o }));
    if (!removeMissing) {
      const inc = new Set(incoming.map((o) => o.id));
      current.forEach((c) => { if (!inc.has(c.id)) result.push(c); });
    }
    return result;
  }

  const api = { exportMonth, exportObjects, parseObjectsFile, parseObjectsWorkbook, diffObjects, applyImport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GrandExcel = api;
})(typeof window !== 'undefined' ? window : globalThis);
