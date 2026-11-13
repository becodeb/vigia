import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadState, saveState, addEvent, mergePiHeartbeat, mergeHomeHeartbeat } from './state.js';
import { diagnose, PI_STALE_MS } from './diagnosis.js';
import { evaluateNotifications } from './notify.js';
import { runProbes } from './probes.js';
import { createPush } from './push.js';
import { bearerOk, makeSession, checkSession, parseCookies, clientIp, safeEqual, SESSION_MS } from './auth.js';

const env = process.env;
const cfg = {
  port: Number(env.PORT) || 3000,
  dataDir: env.DATA_DIR || '/data',
  dashPassword: env.DASH_PASSWORD || '',
  piToken: env.PI_TOKEN || '',
  homeToken: env.HOME_TOKEN || '',
  vapidPublic: env.VAPID_PUBLIC_KEY || '',
  vapidPrivate: env.VAPID_PRIVATE_KEY || '',
  vapidSubject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  piHost: env.PI_HOST || 'mastro.becode.com.ar',
  piSshPort: Number(env.PI_SSH_PORT) || 22,
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
};
if (!env.SESSION_SECRET) console.warn('SESSION_SECRET not set: sessions reset on restart');

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const state = loadState(cfg.dataDir);
const push = createPush(cfg, state);
const save = () => {
  try {
    saveState(cfg.dataDir, state);
  } catch (e) {
    console.error('save failed', e.message);
  }
};

async function evaluate() {
  const now = Date.now();
  const diag = diagnose(state, now, cfg);
  const piFresh = !!state.pi && now - state.pi.lastSeen <= PI_STALE_MS;
  const lines = evaluateNotifications(state, diag, piFresh);
  for (const l of lines) addEvent(state, l.text, l.level, now);
  save();
  if (lines.length) {
    const worst = lines.some((l) => l.level === 'down') ? 'down' : lines.some((l) => l.level === 'warn') ? 'warn' : 'ok';
    const title = `vigia: ${worst === 'ok' ? 'recovered' : diag.title}`;
    await push.sendAll(title, lines.map((l) => l.text).join('\n'));
    save();
  }
}

let probing = false;
async function tick() {
  if (probing) return;
  probing = true;
  try {
    await runProbes(state, cfg);
    await evaluate();
  } catch (e) {
    console.error('tick failed', e);
  } finally {
    probing = false;
  }
}

// ---- http helpers
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
const send = (res, code, body, headers = {}) => {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'content-type': isObj ? 'application/json' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
};
function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}
const loggedIn = (req) => checkSession(cfg.sessionSecret, parseCookies(req.headers.cookie).vigia_session);

const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) return false;
  return a.n >= 10;
}
function noteFail(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) attempts.set(ip, { n: 1, reset: now + 5 * 60 * 1000 });
  else a.n++;
}

function publicState() {
  const now = Date.now();
  const diag = diagnose(state, now, cfg);
  return {
    now,
    piHost: cfg.piHost,
    diag: { level: diag.level, code: diag.code, title: diag.title, detail: diag.detail },
    pi: state.pi && { ...state.pi, ageMs: now - state.pi.lastSeen },
    dnsIp: state.probes?.dns?.ip || null,
    ssh: state.probes?.ssh || null,
    items: Object.values(state.items).map((i) => ({
      id: i.id,
      kind: i.kind,
      name: i.name,
      detail: i.detail,
      missing: !!i.missing,
      ext: i.ext ? { ok: i.ext.ok, detail: i.ext.detail } : null,
      ...diag.items[i.id],
    })),
    home: Object.values(state.home).map((h) => ({ ...h, ageMs: now - h.lastSeen })),
    events: state.events.slice(-100).reverse(),
    pushCount: state.push.length,
    pushEnabled: push.enabled,
  };
}

async function handleApi(req, res, url) {
  const m = req.method;
  const p = url.pathname;
  const ip = clientIp(req);

  if (m === 'POST' && p === '/api/pi/heartbeat') {
    if (!bearerOk(req, cfg.piToken)) return send(res, 401, { error: 'unauthorized' });
    mergePiHeartbeat(state, await readJson(req), Date.now());
    await evaluate();
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/home/heartbeat') {
    if (!bearerOk(req, cfg.homeToken)) return send(res, 401, { error: 'unauthorized' });
    if (!mergeHomeHeartbeat(state, await readJson(req), ip, Date.now())) return send(res, 400, { error: 'host required' });
    save();
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/login') {
    if (throttled(ip)) return send(res, 429, { error: 'too many attempts' });
    const body = await readJson(req, 10_000);
    if (!cfg.dashPassword || typeof body.password !== 'string' || !safeEqual(body.password, cfg.dashPassword)) {
      noteFail(ip);
      return send(res, 401, { error: 'wrong password' });
    }
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, {
      'set-cookie': `vigia_session=${makeSession(cfg.sessionSecret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`,
    });
  }

  if (!loggedIn(req)) return send(res, 401, { error: 'login required' });

  if (m === 'GET' && p === '/api/state') return send(res, 200, publicState());
  if (m === 'GET' && p === '/api/push/key') return send(res, 200, { key: cfg.vapidPublic });
  if (m === 'POST' && p === '/api/push/subscribe') {
    if (!push.subscribe(await readJson(req))) return send(res, 400, { error: 'bad subscription' });
    save();
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/push/test') {
    const sent = await push.sendAll('vigia: test', 'Notifications are working.');
    save();
    return send(res, 200, { sent });
  }
  let mm;
  if (m === 'DELETE' && (mm = /^\/api\/items\/(.+)$/.exec(p))) {
    const id = decodeURIComponent(mm[1]);
    if (!state.items[id]) return send(res, 404, { error: 'not found' });
    delete state.items[id];
    save();
    return send(res, 200, { ok: true });
  }
  if (m === 'DELETE' && (mm = /^\/api\/home\/(.+)$/.exec(p))) {
    const host = decodeURIComponent(mm[1]);
    if (!state.home[host]) return send(res, 404, { error: 'not found' });
    delete state.home[host];
    save();
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.resolve(publicDir, `.${rel}`);
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found');
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': rel === '/sw.js' ? 'no-cache' : 'public, max-age=300',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return send(res, 200, 'ok');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    return serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.message === 'bad json' || e.message === 'too large' ? 400 : 500, { error: e.message });
  }
});

server.listen(cfg.port, () => console.log(`vigia listening on :${cfg.port}`));
setTimeout(tick, 5000);
setInterval(tick, 60_000);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { save(); process.exit(0); });
