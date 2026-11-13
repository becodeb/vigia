import crypto from 'node:crypto';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
export const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

export function bearerOk(req, token) {
  if (!token) return false;
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  return !!m && safeEqual(m[1], token);
}

const DAY = 24 * 3600 * 1000;
export const SESSION_MS = 90 * DAY;
const sign = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export function makeSession(secret, now = Date.now()) {
  const exp = String(now + SESSION_MS);
  return `${exp}.${sign(secret, exp)}`;
}

export function checkSession(secret, value, now = Date.now()) {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(sig, sign(secret, exp));
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
