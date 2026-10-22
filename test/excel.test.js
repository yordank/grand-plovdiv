const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
globalThis.XLSX = require('xlsx');
globalThis.GrandCalc = require('../public/js/calc');
globalThis.GrandFmt = require('../public/js/format');
const E = require('../public/js/excel');
const objects = require('../data/objects.json');

const readFile = (p) => XLSX.read(fs.readFileSync(p), { type: 'buffer' });

test('внася оригиналния Excel на управителя', () => {
  const r = E.parseObjectsWorkbook(readFile(path.join(__dirname, '..', 'data', 'source', 'obekti-idealni-chasti.xlsx')));
  assert.strictEqual(r.rows.length, 257);
  assert.strictEqual(r.rows[0].id, 'ГАРАЖ');
  assert.strictEqual(r.rows[0].share, 19.588);
  assert.ok(Math.abs(r.rows.reduce((s, o) => s + o.share, 0) - 100) < 1e-6);
  assert.strictEqual(r.hasFlags, false);
  const d = E.diffObjects(objects, r.rows);
  assert.deepStrictEqual([d.changed.length, d.added.length, d.missing.length], [0, 0, 0], 'същият списък');
});

test('експорт и обратно внасяне на обектите пази отметките', async () => {
  const mod = objects.map((o, i) => (i === 5 ? { ...o, chillers: !o.chillers, note: 'сменено' } : o));
  const blob = await E.exportObjects(mod);
  const wb = XLSX.read(Buffer.from(await blob.arrayBuffer()), { type: 'buffer' });
  const r = E.parseObjectsWorkbook(wb);
  assert.strictEqual(r.hasFlags, true);
  const d = E.diffObjects(objects, r.rows);
  assert.strictEqual(d.changed.length, 1);
  assert.strictEqual(d.changed[0].to.id, objects[5].id);
  const applied = E.applyImport(objects, r.rows, true);
  assert.strictEqual(applied[5].chillers, !objects[5].chillers);
  assert.strictEqual(applied[5].note, 'сменено');
});

test('нов и липсващ обект', () => {
  const inc = objects.slice(1).map((o) => ({ id: o.id, share: o.share }));
  inc.push({ id: '2-99', share: 0.1 });
  const d = E.diffObjects(objects, inc);
  assert.strictEqual(d.added.length, 1);
  assert.strictEqual(d.missing.length, 1);
  const keep = E.applyImport(objects, inc, false);
  assert.strictEqual(keep.length, 258);
  const drop = E.applyImport(objects, inc, true);
  assert.strictEqual(drop.length, 257);
  const nw = drop.find((o) => o.id === '2-99');
  assert.deepStrictEqual([nw.kind, nw.floor, nw.chillers, nw.water], ['unit', 2, true, true]);
});

test('експорт на месец: сборовете в Excel съвпадат', async () => {
  const month = { fixedItems: [{ name: 'Охрана', amount: 25000 }], water: 800, power: 6000, chillers: 9000, revenueItems: [{ name: 'Реклама', amount: 3000 }], deductMode: 'full' };
  const result = GrandCalc.calculate(objects, GrandCalc.monthInput(month));
  const blob = await E.exportMonth({ monthId: '2027-01', month, result, locked: false });
  const wb = XLSX.read(Buffer.from(await blob.arrayBuffer()), { type: 'buffer' });
  assert.deepStrictEqual(wb.SheetNames, ['Справка', 'Сметки']);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Сметки']);
  const data = rows.filter((x) => x['Обект'] !== 'ОБЩО');
  assert.strictEqual(data.length, 257);
  const total = data.reduce((s, x) => s + Math.round(x['Общо €'] * 100), 0);
  assert.strictEqual(total, 3780000);
});

test('грешен файл дава ясна грешка', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]), 'x');
  assert.throws(() => E.parseObjectsWorkbook(wb), /обект/);
});
