// Разпределение на месечните разходи по Методиката на ТАЦ „Гранд“
// (Приложение № 8 към Протокол от ОС на ЕС от 06.10.2026 г.).
// Един и същ файл работи в браузъра и в Node.js.
(function (root) {
  const PARTS = ['fixed', 'water', 'power', 'chillers'];

  const num = (v) => {
    const x = typeof v === 'string' ? Number(v.replace(/\s/g, '').replace(',', '.')) : Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const cents = (x) => Math.round(x * 100);
  const sumItems = (items) => (items || []).reduce((s, it) => s + num(it && it.amount), 0);

  // Месец → вход за изчислението
  function monthInput(m) {
    m = m || {};
    let deductPct = 100;
    if (m.deductMode === 'none') deductPct = 0;
    else if (m.deductMode === 'partial') deductPct = Math.min(Math.max(num(m.deductPct), 0), 100);
    return {
      fixed: sumItems(m.fixedItems),
      water: num(m.water),
      power: num(m.power),
      chillers: num(m.chillers),
      revenue: sumItems(m.revenueItems),
      deductPct,
    };
  }

  // Разпределя сума в центове по тегла; остатъкът от закръглянето отива
  // към обектите с най-голяма дробна част, за да е сборът точно равен.
  function allocate(totalCents, weights) {
    const W = weights.reduce((s, w) => s + w, 0);
    const out = weights.map(() => 0);
    if (!W || !totalCents) return out;
    const sign = totalCents < 0 ? -1 : 1;
    const T = Math.abs(totalCents);
    const raw = weights.map((w) => (T * w) / W);
    let used = 0;
    raw.forEach((r, i) => { out[i] = Math.floor(r + 1e-9); used += out[i]; });
    const order = raw
      .map((r, i) => ({ i, frac: r - out[i] }))
      .filter((x) => weights[x.i] > 0)
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; used < T && order.length; k = (k + 1) % order.length) {
      out[order[k].i] += 1;
      used += 1;
    }
    return out.map((c) => sign * c);
  }

  /**
   * objects: [{ id, share, kind, floor, fixed, water, power, chillers, note }]
   * input:   { fixed, water, power, chillers, revenue, deductPct }
   * Допускане: приспаднатите приходи намаляват перо „постоянни разходи“.
   * Връща суми в евро, закръглени до цент; сборът по всяко перо е точен.
   */
  function calculate(objects, input) {
    input = input || {};
    const deducted = cents(num(input.revenue) * Math.min(Math.max(num(input.deductPct), 0), 100) / 100) / 100;
    const pools = {
      fixed: cents(num(input.fixed) - deducted) / 100,
      water: cents(num(input.water)) / 100,
      power: cents(num(input.power)) / 100,
      chillers: cents(num(input.chillers)) / 100,
    };
    const weights = {
      fixed: objects.map((o) => (o.fixed ? 1 : 0)),
      water: objects.map((o) => (o.water ? 1 : 0)),
      power: objects.map((o) => (o.power ? num(o.share) : 0)),
      chillers: objects.map((o) => (o.chillers ? num(o.share) : 0)),
    };
    const bases = {
      fixed: weights.fixed.reduce((s, w) => s + w, 0),
      water: weights.water.reduce((s, w) => s + w, 0),
      power: Math.round(weights.power.reduce((s, w) => s + w, 0) * 1e6) / 1e6,
      chillers: Math.round(weights.chillers.reduce((s, w) => s + w, 0) * 1e6) / 1e6,
    };
    const alloc = {};
    PARTS.forEach((p) => { alloc[p] = allocate(cents(pools[p]), weights[p]); });

    const rows = objects.map((o, i) => {
      const parts = {};
      let t = 0;
      PARTS.forEach((p) => { parts[p] = alloc[p][i] / 100; t += alloc[p][i]; });
      return {
        id: o.id, share: num(o.share), kind: o.kind, floor: o.floor,
        fixed: !!o.fixed, water: !!o.water, power: !!o.power, chillers: !!o.chillers,
        note: o.note || '', parts, total: t / 100,
      };
    });

    const warnings = [];
    PARTS.forEach((p) => {
      if (pools[p] && !bases[p]) warnings.push(`Няма участващи обекти в перо „${LABELS[p]}“ — сумата не е разпределена.`);
    });
    if (pools.fixed < 0) warnings.push('Приспаднатите приходи са по-големи от постоянните разходи.');

    const totalPool = cents(pools.fixed + pools.water + pools.power + pools.chillers) / 100;
    const distributed = rows.reduce((s, r) => s + cents(r.total), 0) / 100;
    return {
      input: { ...input },
      deducted, pools, bases, rows, totalPool, distributed,
      payers: rows.filter((r) => r.total !== 0).length,
      balanced: Math.abs(totalPool - distributed) < 0.005 && warnings.length === 0,
      warnings,
    };
  }

  const LABELS = {
    fixed: 'Постоянни текущи разходи',
    water: 'Вода за общите части',
    power: 'Електроенергия за общите части',
    chillers: 'Електроенергия за чилърите',
  };

  // Какво се пази при заключване: обектите и сметките, за да не се променя историята
  function snapshotOf(objects, result) {
    return {
      objects: objects.map((o) => ({ ...o })),
      pools: result.pools, bases: result.bases, deducted: result.deducted,
      totalPool: result.totalPool, payers: result.payers,
      rows: result.rows.map((r) => ({ id: r.id, share: r.share, parts: r.parts, total: r.total })),
    };
  }

  // Обратно: снимка → резултат във вида на calculate()
  function fromSnapshot(s) {
    const byId = {};
    (s.objects || []).forEach((o) => { byId[o.id] = o; });
    const rows = s.rows.map((r) => {
      const o = byId[r.id] || {};
      return {
        id: r.id, share: r.share, kind: o.kind, floor: o.floor,
        fixed: !!o.fixed, water: !!o.water, power: !!o.power, chillers: !!o.chillers,
        note: o.note || '', parts: r.parts, total: r.total,
      };
    });
    return {
      deducted: s.deducted, pools: s.pools, bases: s.bases, rows,
      totalPool: s.totalPool, distributed: s.totalPool, payers: s.payers,
      balanced: true, warnings: [], locked: true,
    };
  }

  const api = { calculate, monthInput, allocate, sumItems, num, snapshotOf, fromSnapshot, PARTS, LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GrandCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
