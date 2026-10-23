const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../server/db');

test('данните остават след рестарт на сървъра', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grand-'));
  const file = path.join(dir, 'sub', 'grand.json');
  let db = store.open(file);
  assert.strictEqual(store.getObjects(db).length, 257, 'първоначален списък');
  store.saveMonth(db, '2027-01', { water: 800, fixedItems: [{ name: 'Охрана', amount: 100 }] });
  store.lockMonth(db, '2027-01', { rows: [] });
  store.setSetting(db, 'admin_user', 'upravitel');
  db = store.open(file);
  const m = store.getMonth(db, '2027-01');
  assert.strictEqual(m.status, 'locked');
  assert.strictEqual(m.water, 800);
  assert.strictEqual(store.getSetting(db, 'admin_user'), 'upravitel');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['grand.json'], 'няма временни файлове');
  fs.rmSync(dir, { recursive: true });
});

test('запис на чернова пази заключването', () => {
  const db = store.open(':memory:');
  store.saveMonth(db, '2027-02', { water: 1 });
  store.lockMonth(db, '2027-02', { rows: [] });
  assert.strictEqual(store.deleteMonth(db, '2027-02'), 0, 'заключен не се трие');
  store.unlockMonth(db, '2027-02');
  assert.strictEqual(store.getMonth(db, '2027-02').snapshot, null);
  assert.strictEqual(store.deleteMonth(db, '2027-02'), 1);
});
