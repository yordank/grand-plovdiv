const path = require('path');
const express = require('express');
const store = require('./db');
const auth = require('./auth');
const { calculate, monthInput, snapshotOf } = require('../public/js/calc');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function createApp({ dbFile, env = process.env, log = console.log } = {}) {
  const db = store.open(dbFile);
  const cfg = auth.setup(db, env, log);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true }));
  auth.routes(app, db, cfg);

  const api = express.Router();
  api.use(auth.requireAuth);

  const monthId = (req, res, next) => {
    if (!MONTH_RE.test(req.params.id)) return res.status(400).json({ error: 'Месецът трябва да е във вид ГГГГ-ММ.' });
    next();
  };

  api.get('/objects', (req, res) => res.json(store.getObjects(db)));

  api.put('/objects', (req, res) => {
    const err = store.validateObjects(req.body);
    if (err) return res.status(400).json({ error: err });
    store.replaceObjects(db, req.body);
    res.json(store.getObjects(db));
  });

  api.get('/months', (req, res) => res.json(store.listMonths(db)));

  api.get('/months/:id', monthId, (req, res) => {
    const m = store.getMonth(db, req.params.id);
    if (!m) return res.status(404).json({ error: 'Няма такъв месец.' });
    res.json(m);
  });

  api.put('/months/:id', monthId, (req, res) => {
    const cur = store.getMonth(db, req.params.id);
    if (cur && cur.status === 'locked') return res.status(409).json({ error: 'Месецът е заключен. Отключи го, за да го промениш.' });
    res.json(store.saveMonth(db, req.params.id, req.body || {}));
  });

  api.post('/months/:id/lock', monthId, (req, res) => {
    const m = store.getMonth(db, req.params.id);
    if (!m) return res.status(404).json({ error: 'Няма такъв месец.' });
    if (m.status === 'locked') return res.status(409).json({ error: 'Месецът вече е заключен.' });
    const objects = store.getObjects(db);
    const result = calculate(objects, monthInput(m));
    if (!result.balanced) return res.status(422).json({ error: 'Сметките не се връзват: ' + (result.warnings.join(' ') || 'сборът не съвпада.') });
    res.json(store.lockMonth(db, req.params.id, snapshotOf(objects, result)));
  });

  api.post('/months/:id/unlock', monthId, (req, res) => {
    const m = store.getMonth(db, req.params.id);
    if (!m) return res.status(404).json({ error: 'Няма такъв месец.' });
    res.json(store.unlockMonth(db, req.params.id));
  });

  api.delete('/months/:id', monthId, (req, res) => {
    const n = store.deleteMonth(db, req.params.id);
    if (!n) return res.status(409).json({ error: 'Само чернова може да се изтрие.' });
    res.json({ ok: true });
  });

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Няма такъв адрес.' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  app.use((err, req, res, next) => {
    log('Грешка:', err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Невалидни данни.' });
    res.status(500).json({ error: 'Вътрешна грешка на сървъра.' });
  });

  app.locals.db = db;
  return app;
}

module.exports = { createApp, MONTH_RE };
