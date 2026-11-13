import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../diagnosis.js';
import { evaluateNotifications } from '../notify.js';

const NOW = 1_000_000_000_000;
const MIN = 60_000;
const cfg = { piHost: 'pi.example.com' };

function item(id, kind, o = {}) {
  return { id, kind, name: id.split(':')[1], ok: true, detail: '', missing: false, missCount: 0, ...o };
}
function web(host, o = {}, ext = { ok: true, detail: 'HTTP 200' }) {
  return item(`web:${host}`, 'web', { ...o, ext: ext && { ...ext, ts: NOW - 30_000 } });
}
function mk({ piAgeMin = 0, items = [], ssh = true, dnsIp = '1.1.1.1', publicIp = '1.1.1.1', home = [] } = {}) {
  return {
    pi: piAgeMin === null ? null : { lastSeen: NOW - piAgeMin * MIN, publicIp },
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    home: Object.fromEntries(home.map((h) => [h.host, h])),
    probes: { ssh: { ok: ssh, ts: NOW - 20_000 }, dns: { ip: dnsIp, ts: NOW - 20_000 } },
    events: [],
  };
}
const homeHost = (host, ageMin, o = {}) => ({ host, lastSeen: NOW - ageMin * MIN, lanPiPing: false, lanPiSsh: false, lanPiHttps: false, ...o });

test('rule 1: all ok', () => {
  const d = diagnose(mk({ items: [web('a.com'), item('container:db', 'container')] }), NOW, cfg);
  assert.equal(d.level, 'ok');
  assert.equal(d.code, 'OK');
});

test('rule 2: internal failures warn and list items', () => {
  const d = diagnose(mk({ items: [web('a.com'), item('container:db', 'container', { ok: false, detail: 'exited' })] }), NOW, cfg);
  assert.equal(d.level, 'warn');
  assert.equal(d.code, 'SERVICES_DOWN');
  assert.match(d.title, /1 service down on the Pi/);
  assert.match(d.detail, /db \(exited\)/);
});

test('rule 3: path broken, DDNS out of date', () => {
  const st = mk({
    items: [web('a.com', {}, { ok: false, detail: 'timeout' }), web('b.com', {}, { ok: false, detail: 'timeout' })],
    ssh: false,
    dnsIp: '1.1.1.1',
    publicIp: '2.2.2.2',
  });
  const d = diagnose(st, NOW, cfg);
  assert.equal(d.level, 'down');
  assert.equal(d.code, 'PATH_BROKEN');
  assert.match(d.detail, /DDNS out of date: DNS says 1\.1\.1\.1, Pi's real IP is 2\.2\.2\.2/);
});

test('rule 3: path broken, IP matches DNS -> forwarding', () => {
  const st = mk({ items: [web('a.com', {}, { ok: false, detail: 'x' })], ssh: false });
  const d = diagnose(st, NOW, cfg);
  assert.equal(d.code, 'PATH_BROKEN');
  assert.match(d.detail, /port forwarding/);
});

test('rule 3 needs SSH failing too: web all failing but ssh ok is only a warn', () => {
  const st = mk({ items: [web('a.com', {}, { ok: false, detail: 'x' })], ssh: true });
  assert.equal(diagnose(st, NOW, cfg).code, 'EXTERNAL_PARTIAL');
});

test('rule 4: some web fail from outside only', () => {
  const st = mk({ items: [web('a.com'), web('b.com', {}, { ok: false, detail: 'HTTP 502' })] });
  const d = diagnose(st, NOW, cfg);
  assert.equal(d.level, 'warn');
  assert.equal(d.code, 'EXTERNAL_PARTIAL');
  assert.match(d.detail, /b\.com fails from outside only/);
  assert.equal(d.items['web:b.com'].status, 'warn');
});

test('rule 5: Pi stale, home fresh and can reach it -> PI_NO_INTERNET', () => {
  const st = mk({ piAgeMin: 10, items: [web('a.com', {}, { ok: false, detail: 'x' })], home: [homeHost('pc', 2, { lanPiPing: true })] });
  const d = diagnose(st, NOW, cfg);
  assert.equal(d.level, 'down');
  assert.equal(d.code, 'PI_NO_INTERNET');
});

test('rule 5: Pi stale, home fresh and cannot reach it -> PI_OFF', () => {
  const st = mk({ piAgeMin: 10, items: [web('a.com', {}, { ok: false, detail: 'x' })], home: [homeHost('pc', 2)] });
  assert.equal(diagnose(st, NOW, cfg).code, 'PI_OFF');
});

test('rule 5: nobody reporting -> HOME_OFFLINE_OR_UNKNOWN with last seen', () => {
  const st = mk({ piAgeMin: 10, items: [web('a.com', {}, { ok: false, detail: 'x' })], home: [homeHost('pc', 60)] });
  const d = diagnose(st, NOW, cfg);
  assert.equal(d.code, 'HOME_OFFLINE_OR_UNKNOWN');
  assert.match(d.detail, /pc 60 min ago/);
});

test('rule 5: Pi stale but web answers outside -> AGENT_SILENT warn', () => {
  const st = mk({ piAgeMin: 10, items: [web('a.com')], home: [homeHost('pc', 2)] });
  const d = diagnose(st, NOW, cfg);
  assert.equal(d.level, 'warn');
  assert.equal(d.code, 'AGENT_SILENT');
});

test('Pi never reported and nothing known', () => {
  const st = mk({ piAgeMin: null });
  const d = diagnose(st, NOW, cfg);
  assert.equal(d.code, 'HOME_OFFLINE_OR_UNKNOWN');
  assert.match(d.detail, /never reported/);
});

test('missing items are ignored by the diagnosis', () => {
  const st = mk({ items: [web('a.com'), item('container:old', 'container', { ok: false, missing: true, missCount: 5 })] });
  const d = diagnose(st, NOW, cfg);
  assert.equal(d.code, 'OK');
  assert.equal(d.items['container:old'].status, 'missing');
});

// ---- notifications
function evalN(st, n = 1) {
  let lines = [];
  for (let i = 0; i < n; i++) lines = evaluateNotifications(st, diagnose(st, NOW, cfg), true);
  return lines;
}

test('notify: item must fail twice, recovery notifies once', () => {
  const st = mk({ items: [item('container:db', 'container')] });
  evalN(st); // baseline
  st.items['container:db'].ok = false;
  assert.equal(evalN(st).filter((l) => /failing/.test(l.text)).length, 0);
  assert.equal(evalN(st).filter((l) => /failing/.test(l.text)).length, 1);
  assert.equal(evalN(st).filter((l) => /failing/.test(l.text)).length, 0);
  st.items['container:db'].ok = true;
  const rec = evalN(st).filter((l) => /recovered/.test(l.text));
  assert.equal(rec.length, 1);
  assert.equal(evalN(st).filter((l) => /recovered/.test(l.text)).length, 0);
});

test('notify: overall change needs two consecutive evaluations', () => {
  const st = mk({ items: [web('a.com')] });
  evalN(st);
  st.items['web:a.com'].ok = false;
  const first = evalN(st).filter((l) => /service/.test(l.text) && /down/.test(l.text));
  assert.equal(first.length, 0);
  assert.ok(evalN(st).some((l) => l.level === 'warn' && /1 service down/.test(l.text)));
});

test('notify: disappeared item pushes once after 3 missed heartbeats', () => {
  const st = mk({ items: [item('container:x', 'container', { missing: true, missCount: 2 })] });
  evalN(st);
  assert.equal(evalN(st).filter((l) => /disappeared/.test(l.text)).length, 0);
  st.items['container:x'].missCount = 3;
  assert.equal(evalN(st).filter((l) => /disappeared/.test(l.text)).length, 1);
  assert.equal(evalN(st).filter((l) => /disappeared/.test(l.text)).length, 0);
});

import { mergePiHeartbeat } from '../state.js';
test('container first seen stopped is not tracked until seen running', () => {
  const st = { items: {}, events: [] };
  mergePiHeartbeat(st, { items: [{ id: 'container:db', kind: 'container', name: 'db', ok: false }] }, 1);
  assert.equal(st.items['container:db'], undefined);
  mergePiHeartbeat(st, { items: [{ id: 'container:db', kind: 'container', name: 'db', ok: true }] }, 2);
  mergePiHeartbeat(st, { items: [{ id: 'container:db', kind: 'container', name: 'db', ok: false }] }, 3);
  assert.equal(st.items['container:db'].ok, false);
});
