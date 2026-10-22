const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Стартира pdf.js в Node със същите глобални обекти като в браузъра
globalThis.window = globalThis;
globalThis.jspdf = require('jspdf');
globalThis.JSZip = require('jszip');
globalThis.GrandCalc = require('../public/js/calc');
globalThis.GrandFmt = require('../public/js/format');
globalThis.GrandLibs = { load: async () => {} };
new Function(fs.readFileSync(path.join(__dirname, '..', 'public', 'vendor', 'onest-fonts.js'), 'utf8'))();
new Function(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pdf.js'), 'utf8'))();
const P = globalThis.GrandPDF;
const objects = require('../data/objects.json');

const month = {
  fixedItems: [{ name: 'Охрана', amount: 12000 }, { name: 'Почистване', amount: 13000 }],
  water: 800, power: 6000, chillers: 9000,
  revenueItems: [{ name: 'Реклама', amount: 3000 }], deductMode: 'full', note: 'Тестова бележка',
};
const result = GrandCalc.calculate(objects, GrandCalc.monthInput(month));
const ctx = { monthId: '2027-01', month, result, locked: true };

const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
async function textOf(blob) {
  const f = path.join(os.tmpdir(), `grand-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, Buffer.from(await blob.arrayBuffer()));
  const t = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f], { encoding: 'utf8' }))[1]);
  fs.unlinkSync(f);
  return { t, pages };
}

test('бележка за обект', { skip: !hasPdftotext }, async () => {
  const row = result.rows.find((r) => r.id === '1-1');
  const { t, pages } = await textOf(await P.slip(ctx, row));
  assert.strictEqual(pages, 1);
  assert.match(t, /GRAND/);
  assert.match(t, /Обект 1-1/);
  assert.match(t, /януари 2027/);
  assert.match(t, /ЗА ПЛАЩАНЕ/);
  assert.ok(t.includes(GrandFmt.eurPdf(row.total)), 'сумата е в бележката');
  assert.match(t, /поравно между 248 обекта/);
});

test('бележка на обект, който не участва в перо', { skip: !hasPdftotext }, async () => {
  const row = result.rows.find((r) => r.id === 'ГАРАЖ');
  const { t } = await textOf(await P.slip(ctx, row));
  assert.match(t, /не участва/);
});

test('всички бележки: по една страница за всеки платец', { skip: !hasPdftotext }, async () => {
  const { pages, t } = await textOf(await P.allSlips(ctx));
  assert.strictEqual(pages, 248);
  assert.ok(!/Обект Тераса/.test(t), 'терасите нямат бележка');
});

test('справка по чл. 11', { skip: !hasPdftotext }, async () => {
  const { t, pages } = await textOf(await P.report(ctx));
  assert.ok(pages >= 4, `страници ${pages}`);
  for (const s of ['Справка за януари 2027', 'Охрана', 'Почистване', 'Реклама', 'Приспаднати изцяло', 'За разпределяне между 248 обекта', '37 800,00 €', 'Тестова бележка', 'Обща тераса']) {
    assert.ok(t.includes(s), 'липсва: ' + s);
  }
  assert.match(t, new RegExp(`стр\\. ${pages} от ${pages}`));
});

test('ZIP с отделни PDF файлове', async () => {
  const small = { ...ctx, result: { ...result, rows: result.rows.slice(0, 12) } };
  const blob = await P.zip(small);
  const z = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const names = Object.keys(z.files);
  assert.strictEqual(names.length, 12);
  assert.ok(names.includes('Belezhka_2027-01_ГАРАЖ.pdf'));
  const first = await z.file(names[0]).async('uint8array');
  assert.strictEqual(Buffer.from(first.slice(0, 5)).toString(), '%PDF-');
});
