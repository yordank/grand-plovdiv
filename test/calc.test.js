const test = require('node:test');
const assert = require('node:assert');
const objects = require('../data/objects.json');
const { calculate, monthInput, allocate } = require('../public/js/calc');

const sample = { fixed: 25000, water: 800, power: 6000, chillers: 9000, revenue: 3000, deductPct: 100 };
const cents = (x) => Math.round(x * 100);
const sumCents = (rows, p) => rows.reduce((s, r) => s + cents(p ? r.parts[p] : r.total), 0);

test('данните за обектите са цели', () => {
  assert.strictEqual(objects.length, 257);
  const total = objects.reduce((s, o) => s + o.share, 0);
  assert.ok(Math.abs(total - 100) < 1e-6, `сбор ${total}`);
  assert.strictEqual(new Set(objects.map((o) => o.id)).size, 257, 'уникални номера');
});

test('всяко перо се разпределя точно до цент', () => {
  const r = calculate(objects, sample);
  assert.ok(r.balanced, r.warnings.join(' '));
  for (const p of ['fixed', 'water', 'power', 'chillers']) {
    assert.strictEqual(sumCents(r.rows, p), cents(r.pools[p]), p);
  }
  assert.strictEqual(sumCents(r.rows), cents(r.totalPool));
  assert.strictEqual(r.totalPool, 37800);
  assert.strictEqual(r.deducted, 3000);
});

test('правилата на методиката', () => {
  const r = calculate(objects, sample);
  const get = (id) => r.rows.find((x) => x.id === id);
  assert.strictEqual(r.bases.fixed, 248, 'поравно без 9-те тераси');
  assert.strictEqual(r.bases.water, 246, 'вода без гараж и хипермаркет');
  for (const row of r.rows.filter((x) => x.kind === 'terrace')) assert.strictEqual(row.total, 0, 'тераса');
  assert.strictEqual(get('ГАРАЖ').parts.water, 0);
  assert.strictEqual(get('ГАРАЖ').parts.chillers, 0);
  assert.strictEqual(get('ЛЕКСИ').parts.chillers, 0);
  assert.ok(r.rows.filter((x) => x.floor === 4).every((x) => x.parts.chillers === 0), '4-ти етаж без чилъри');
  assert.ok(get('1-1').parts.chillers > 0 && get('3-69').parts.chillers > 0, 'етажи 1–3 с чилъри');
  // ток общи: 6000 × 0.081 / 89.529
  assert.ok(Math.abs(get('1-1').parts.power - 6000 * 0.081 / 89.529) < 0.01);
  assert.ok(Math.abs(get('1-1').total - 115.84) <= 0.01, `1-1 = ${get('1-1').total}`);
});

test('приходи по чл. 10', () => {
  const none = calculate(objects, { ...sample, deductPct: 0 });
  assert.strictEqual(none.pools.fixed, 25000);
  const half = calculate(objects, { ...sample, deductPct: 50 });
  assert.strictEqual(half.pools.fixed, 23500);
  const m = { fixedItems: [{ name: 'Охрана', amount: 10000 }, { name: 'Чистене', amount: '5 000,50' }], revenueItems: [{ name: 'Реклама', amount: 1000 }], deductMode: 'partial', deductPct: 25, water: 1, power: 2, chillers: 3 };
  assert.deepStrictEqual(monthInput(m), { fixed: 15000.5, water: 1, power: 2, chillers: 3, revenue: 1000, deductPct: 25 });
  assert.strictEqual(monthInput({ ...m, deductMode: 'none' }).deductPct, 0);
  assert.strictEqual(monthInput({ ...m, deductMode: 'full' }).deductPct, 100);
});

test('закръгляне: остатъкът отива при най-голямата дробна част', () => {
  assert.deepStrictEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepStrictEqual(allocate(0, [1, 2]), [0, 0]);
  assert.deepStrictEqual(allocate(10, [0, 0]), [0, 0]);
  assert.deepStrictEqual(allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  const a = allocate(123457, objects.map((o) => o.share));
  assert.strictEqual(a.reduce((s, x) => s + x, 0), 123457);
});

test('предупреждения при грешни данни', () => {
  const noChill = objects.map((o) => ({ ...o, chillers: false }));
  const r = calculate(noChill, sample);
  assert.strictEqual(r.balanced, false);
  assert.ok(r.warnings.some((w) => w.includes('чилърите')));
  const neg = calculate(objects, { ...sample, fixed: 100, revenue: 500 });
  assert.ok(neg.warnings.some((w) => w.includes('приходи')));
  const zero = calculate(objects, {});
  assert.ok(zero.balanced);
  assert.strictEqual(zero.totalPool, 0);
});
