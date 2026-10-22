const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server/app');

let server, base, cookie = '';

async function call(method, url, body, useCookie = true) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(useCookie && cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch { /* празно */ }
  return { status: res.status, data };
}

test.before(async () => {
  const app = createApp({ dbFile: ':memory:', env: { ADMIN_USER: 'upravitel', ADMIN_PASSWORD: 'tajna-parola-1' }, log: () => {} });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('без вход няма достъп', async () => {
  assert.strictEqual((await call('GET', '/api/objects', undefined, false)).status, 401);
  assert.strictEqual((await call('GET', '/api/me', undefined, false)).data.signedIn, false);
  assert.strictEqual((await call('GET', '/health', undefined, false)).status, 200);
});

test('грешна парола се отказва', async () => {
  const r = await call('POST', '/api/login', { user: 'upravitel', password: 'грешна' }, false);
  assert.strictEqual(r.status, 401);
  assert.ok(!cookie, 'няма бисквитка');
});

test('вход и обекти', async () => {
  const r = await call('POST', '/api/login', { user: 'upravitel', password: 'tajna-parola-1' });
  assert.strictEqual(r.status, 200);
  assert.ok(cookie.startsWith('grand_session='));
  assert.strictEqual((await call('GET', '/api/me')).data.user, 'upravitel');
  const objs = (await call('GET', '/api/objects')).data;
  assert.strictEqual(objs.length, 257);
  assert.strictEqual(objs[0].id, 'ГАРАЖ');
});

test('подправена бисквитка не работи', async () => {
  const saved = cookie;
  cookie = saved.slice(0, -3) + 'abc';
  assert.strictEqual((await call('GET', '/api/me')).data.signedIn, false);
  assert.strictEqual((await call('GET', '/api/objects')).status, 401);
  cookie = saved;
});

test('валидиране на обекти', async () => {
  assert.strictEqual((await call('PUT', '/api/objects', [])).status, 400);
  assert.strictEqual((await call('PUT', '/api/objects', [{ id: 'a', share: 1 }, { id: 'a', share: 2 }])).status, 400);
  assert.strictEqual((await call('PUT', '/api/objects', [{ id: 'a', share: 'x' }])).status, 400);
  const objs = (await call('GET', '/api/objects')).data;
  objs[1].chillers = true;
  const saved = (await call('PUT', '/api/objects', objs)).data;
  assert.strictEqual(saved[1].chillers, true);
  assert.strictEqual(saved.length, 257);
  objs[1].chillers = false;
  await call('PUT', '/api/objects', objs);
});

test('месец: чернова → заключване → защита → отключване', async () => {
  assert.strictEqual((await call('PUT', '/api/months/2027-13', {})).status, 400);
  const draft = {
    fixedItems: [{ name: 'Охрана', amount: 10000 }, { name: 'Чистене', amount: 15000 }],
    water: 800, power: 6000, chillers: 9000,
    revenueItems: [{ name: 'Реклама', amount: 3000 }], deductMode: 'full', note: 'тест',
    status: 'locked', snapshot: { hack: true },
  };
  let r = await call('PUT', '/api/months/2027-01', draft);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.status, 'draft', 'клиентът не може сам да заключи');
  assert.strictEqual(r.data.snapshot, null);
  assert.strictEqual(r.data.fixedItems.length, 2);

  r = await call('POST', '/api/months/2027-01/lock');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.status, 'locked');
  assert.strictEqual(r.data.snapshot.rows.length, 257);
  assert.strictEqual(r.data.snapshot.totalPool, 37800);
  const sum = r.data.snapshot.rows.reduce((s, x) => s + Math.round(x.total * 100), 0);
  assert.strictEqual(sum, 3780000);

  assert.strictEqual((await call('PUT', '/api/months/2027-01', draft)).status, 409);
  assert.strictEqual((await call('DELETE', '/api/months/2027-01')).status, 409);
  assert.strictEqual((await call('POST', '/api/months/2027-01/lock')).status, 409);

  const list = (await call('GET', '/api/months')).data;
  assert.strictEqual(list.length, 1);

  r = await call('POST', '/api/months/2027-01/unlock');
  assert.strictEqual(r.data.status, 'draft');
  assert.strictEqual((await call('DELETE', '/api/months/2027-01')).status, 200);
  assert.strictEqual((await call('GET', '/api/months/2027-01')).status, 404);
});

test('несвързани сметки не се заключват', async () => {
  const objs = (await call('GET', '/api/objects')).data;
  await call('PUT', '/api/objects', objs.map((o) => ({ ...o, chillers: false })));
  await call('PUT', '/api/months/2027-02', { chillers: 500 });
  const r = await call('POST', '/api/months/2027-02/lock');
  assert.strictEqual(r.status, 422);
  await call('PUT', '/api/objects', objs);
});

test('смяна на парола и изход', async () => {
  assert.strictEqual((await call('POST', '/api/password', { current: 'x', next: 'novaparola123' })).status, 400);
  assert.strictEqual((await call('POST', '/api/password', { current: 'tajna-parola-1', next: 'kratka' })).status, 400);
  assert.strictEqual((await call('POST', '/api/logout')).status, 200);
  assert.strictEqual((await call('GET', '/api/me')).data.signedIn, false);
  assert.strictEqual((await call('GET', '/api/months')).status, 401);
});

test('невалиден JSON дава 400', async () => {
  await call('POST', '/api/login', { user: 'upravitel', password: 'tajna-parola-1' });
  const r = await call('PUT', '/api/months/2027-03', '{лош');
  assert.strictEqual(r.status, 400);
});
