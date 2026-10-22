const assert = require('assert');
const objects = require('../data/objects.json');
const { calculate } = require('../lib/calc');

const input = { fixed: 25000, water: 800, power: 6000, chillers: 9000, revenue: 3000, deductPct: 100 };
const r = calculate(objects, input);

assert.strictEqual(objects.length, 257);
assert.ok(Math.abs(objects.reduce((s, o) => s + o.share, 0) - 100) < 0.001, 'идеалните части = 100%');
assert.ok(r.balanced, 'разпределеното = разходите');
assert.strictEqual(r.bases.fixed, 248);
assert.strictEqual(r.bases.water, 246);

const get = (id) => r.rows.find((x) => x.id === id);
assert.strictEqual(get('Обща тераса').total, 0, 'терасите не плащат');
assert.strictEqual(get('ГАРАЖ').parts.chillers, 0, 'гаражът не плаща чилъри');
assert.strictEqual(get('4-5').parts.chillers, 0, '4-ти етаж не плаща чилъри');
assert.ok(Math.abs(get('1-1').total - 115.84) < 0.01, '1-1 = 115.84 €');
assert.ok(Math.abs(get('ГАРАЖ').total - 1401.45) < 0.01, 'гараж = 1401.45 €');

console.log('OK — всички проверки минаха');
