const crypto = require('crypto');
const store = require('./db');

const COOKIE = 'grand_session';
const MAX_AGE_S = 60 * 60 * 24 * 14; // 14 дни

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return `${salt}:${h}`;
}

function checkPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  const a = Buffer.from(crypto.scryptSync(String(pw), salt, 32).toString('hex'));
  const b = Buffer.from(h);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setup(db, env = process.env, log = console.log) {
  const user = (env.ADMIN_USER || store.getSetting(db, 'admin_user') || 'admin').trim();
  store.setSetting(db, 'admin_user', user);

  if (env.ADMIN_PASSWORD) {
    const cur = store.getSetting(db, 'admin_hash');
    if (!checkPassword(env.ADMIN_PASSWORD, cur)) store.setSetting(db, 'admin_hash', hashPassword(env.ADMIN_PASSWORD));
  } else if (!store.getSetting(db, 'admin_hash')) {
    const pw = crypto.randomBytes(9).toString('base64url');
    store.setSetting(db, 'admin_hash', hashPassword(pw));
    log(`\n  Първо стартиране. Вход: потребител „${user}“, парола „${pw}“`);
    log('  Запиши паролата или задай своя с ADMIN_PASSWORD.\n');
  }

  let secret = env.SESSION_SECRET || store.getSetting(db, 'session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    store.setSetting(db, 'session_secret', secret);
  }
  return { user, secret };
}

function sign(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(secret, token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Прост лимит на грешните опити за вход: 10 на IP за 15 минути
const fails = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  fails.set(ip, list);
  return list.length >= 10;
}
function addFail(ip) { fails.set(ip, [...(fails.get(ip) || []), Date.now()]); }

function routes(app, db, cfg) {
  const secure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';
  const setCookie = (req, res, value, maxAge) => {
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);
  };

  app.use((req, res, next) => {
    req.session = verify(cfg.secret, readCookie(req, COOKIE));
    next();
  });

  app.post('/api/login', (req, res) => {
    const ip = req.ip || 'x';
    if (tooMany(ip)) return res.status(429).json({ error: 'Твърде много опити. Опитай след 15 минути.' });
    const { user, password } = req.body || {};
    const ok = String(user || '').trim() === store.getSetting(db, 'admin_user') && checkPassword(password, store.getSetting(db, 'admin_hash'));
    if (!ok) { addFail(ip); return res.status(401).json({ error: 'Грешен потребител или парола.' }); }
    const token = sign(cfg.secret, { u: store.getSetting(db, 'admin_user'), role: 'admin', exp: Math.floor(Date.now() / 1000) + MAX_AGE_S });
    setCookie(req, res, token, MAX_AGE_S);
    res.json({ user: store.getSetting(db, 'admin_user'), canEdit: true });
  });

  app.post('/api/logout', (req, res) => { setCookie(req, res, '', 0); res.json({ ok: true }); });

  app.get('/api/me', (req, res) => {
    if (!req.session) return res.json({ signedIn: false });
    res.json({ signedIn: true, user: req.session.u, canEdit: req.session.role === 'admin' });
  });

  app.post('/api/password', requireAuth, (req, res) => {
    const { current, next } = req.body || {};
    if (!checkPassword(current, store.getSetting(db, 'admin_hash'))) return res.status(400).json({ error: 'Сегашната парола е грешна.' });
    if (!next || String(next).length < 8) return res.status(400).json({ error: 'Новата парола трябва да е поне 8 знака.' });
    store.setSetting(db, 'admin_hash', hashPassword(next));
    res.json({ ok: true });
  });
}

function requireAuth(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Не си влязъл.' });
  next();
}

module.exports = { setup, routes, requireAuth, hashPassword, checkPassword, sign, verify };
