const $ = (id) => document.getElementById(id);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

function age(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m} min ago`;
  const hr = Math.round(m / 60);
  return hr < 48 ? `${hr} h ago` : `${Math.round(hr / 24)} d ago`;
}
function dur(sec) {
  if (sec == null) return '-';
  const d = Math.floor(sec / 86400), hr = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`;
}
const pct = (v) => (v == null ? '-' : `${Math.round(v)}%`);
const dot = (cls, title) => h('span', { class: `dot ${cls || ''}`, title: title || '' });
const statusClass = (s) => (s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : s === 'down' ? 'down' : '');

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error('login required');
  }
  return res;
}

function showLogin() {
  $('dash').hidden = true;
  $('login').hidden = false;
}

function renderItem(it) {
  let dots;
  if (it.kind === 'web') {
    dots = h('span', { class: 'dots' }, dot(it.internalOk == null ? '' : it.internalOk ? 'ok' : 'down', 'inside (Pi)'), 'in ',
      dot(it.externalOk == null ? '' : it.externalOk ? 'ok' : 'down', `outside: ${it.ext?.detail || 'unknown'}`), 'out');
  } else {
    dots = dot(statusClass(it.status), it.status);
  }
  const row = h('div', { class: `item${it.missing ? ' missing' : ''}` },
    h('div', { class: 'name' }, it.name, h('div', { class: 'detail' }, it.missing ? 'disappeared' : it.detail || '')),
    dots);
  row.append(h('button', { class: 'x', title: it.missing ? 'Forget' : 'Stop monitoring this item', onclick: async () => {
    if (!it.missing && !confirm(`Stop monitoring ${it.name}?`)) return;
    await api(`/api/items/${encodeURIComponent(it.id)}`, { method: 'DELETE' });
    refresh();
  } }, it.missing ? 'delete' : 'ignore'));
  return row;
}

function render(s) {
  $('login').hidden = true;
  $('dash').hidden = false;
  $('banner').className = `banner ${s.diag.level}`;
  $('banner-title').textContent = s.diag.title;
  $('banner-detail').textContent = s.diag.detail;

  const pi = s.pi;
  const vit = [
    ['Last heartbeat', pi ? age(pi.ageMs) : 'never'],
    ['Uptime', pi ? dur(pi.uptimeSec) : '-'],
    ['Load', pi?.load1 ?? '-'],
    ['Memory', pct(pi?.memUsedPct)],
    ['Disk', pct(pi?.diskUsedPct)],
    ['Temp', pi?.tempC == null ? '-' : `${pi.tempC.toFixed(0)} C`],
    ['Public IP (Pi)', pi?.publicIp || '-'],
    [`DNS ${s.piHost}`, s.dnsIp || '-'],
    ['SSH from outside', s.ssh ? (s.ssh.ok ? 'open' : 'closed') : '-'],
  ];
  $('vitals').replaceChildren(...vit.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, String(v)))));

  const groups = [['agent', 'Agents'], ['web', 'Web apps'], ['container', 'Containers'], ['system', 'System'], ['ddns', 'DDNS']];
  $('groups').replaceChildren(...groups.flatMap(([kind, label]) => {
    const list = s.items.filter((i) => i.kind === kind).sort((a, b) => a.missing - b.missing || a.name.localeCompare(b.name));
    return list.length ? [h('h2', {}, label), h('div', { class: 'list' }, list.map(renderItem))] : [];
  }), ...(s.ignored.length ? [h('h2', {}, 'Ignored'), h('div', { class: 'list' }, s.ignored.map((id) =>
    h('div', { class: 'item missing' }, h('div', { class: 'name' }, id),
      h('button', { class: 'x', title: 'Monitor again', onclick: async () => {
        await api(`/api/ignored/${encodeURIComponent(id)}`, { method: 'DELETE' });
        refresh();
      } }, 'restore'))))] : []));

  $('home').replaceChildren(s.home.length
    ? h('table', {},
      h('tr', {}, ['Host', 'Seen', 'IP', 'Ping', 'SSH', 'HTTPS', ''].map((t) => h('th', {}, t))),
      s.home.map((x) => h('tr', {},
        h('td', {}, x.host), h('td', {}, age(x.ageMs)), h('td', {}, x.ip || '-'),
        h('td', {}, dot(x.lanPiPing ? 'ok' : 'down')), h('td', {}, dot(x.lanPiSsh ? 'ok' : 'down')), h('td', {}, dot(x.lanPiHttps ? 'ok' : 'down')),
        h('td', {}, h('button', { class: 'x', onclick: async () => {
          await api(`/api/home/${encodeURIComponent(x.host)}`, { method: 'DELETE' });
          refresh();
        } }, 'x')))))
    : h('p', { class: 'muted' }, 'No home computer has reported yet.'));

  $('events').replaceChildren(...s.events.map((e) => h('li', {},
    h('time', {}, new Date(e.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
    h('span', { class: e.level }, e.text))));
  $('push-status').textContent = s.pushEnabled ? `${s.pushCount} device(s) subscribed` : 'Push not configured on the server';
  $('updated').textContent = `Updated ${new Date(s.now).toLocaleTimeString()}`;
}

async function refresh() {
  try {
    const res = await api('/api/state');
    if (res.ok) render(await res.json());
  } catch { /* offline or logged out */ }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
  if (res.ok) { $('password').value = ''; $('login-error').textContent = ''; refresh(); }
  else $('login-error').textContent = res.status === 429 ? 'Too many attempts, wait a few minutes.' : 'Wrong password.';
});

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

$('enable-push').addEventListener('click', async () => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push is not supported in this browser (on iPhone, install the app to the home screen first).');
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Permission denied.');
    const reg = await navigator.serviceWorker.ready;
    const { key } = await (await api('/api/push/key')).json();
    if (!key) throw new Error('Server has no VAPID key.');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    const res = await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
    $('push-status').textContent = res.ok ? 'Notifications enabled.' : 'Subscribe failed.';
    refresh();
  } catch (e) {
    $('push-status').textContent = e.message;
  }
});

$('test-push').addEventListener('click', async () => {
  const res = await api('/api/push/test', { method: 'POST', body: '{}' });
  const { sent } = await res.json();
  $('push-status').textContent = sent ? `Test sent to ${sent} device(s).` : 'No device received it.';
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
refresh();
setInterval(refresh, 20000);
