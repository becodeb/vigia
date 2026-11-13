import fs from 'node:fs';
import path from 'node:path';

export function emptyState() {
  return { pi: null, items: {}, home: {}, probes: {}, events: [], push: [], notify: {} };
}

export function loadState(dir) {
  try {
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) };
  } catch {
    return emptyState();
  }
}

export function saveState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'state.json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const KINDS = new Set(['web', 'container', 'agent', 'system', 'ddns']);

export function addEvent(state, text, level, now) {
  state.events.push({ ts: now, text: String(text).slice(0, 500), level });
  if (state.events.length > 200) state.events.splice(0, state.events.length - 200);
}

export function mergePiHeartbeat(state, body, now) {
  const b = body && typeof body === 'object' ? body : {};
  state.pi = {
    lastSeen: now,
    ts: num(b.ts),
    hostname: str(b.hostname, 100),
    lanIp: str(b.lanIp, 60),
    publicIp: str(b.publicIp, 60),
    uptimeSec: num(b.uptimeSec),
    load1: num(b.load1),
    memUsedPct: num(b.memUsedPct),
    diskUsedPct: num(b.diskUsedPct),
    tempC: num(b.tempC),
  };
  const incoming = Array.isArray(b.items) ? b.items.slice(0, 500) : [];
  const seen = new Set();
  const added = [];
  for (const raw of incoming) {
    if (!raw || typeof raw.id !== 'string' || !KINDS.has(raw.kind)) continue;
    const id = raw.id.slice(0, 200);
    seen.add(id);
    let it = state.items[id];
    // A container first seen stopped is a deliberately parked one (dev DBs, old builds):
    // only start tracking it once it has been seen running.
    if (!it && raw.kind === 'container' && !raw.ok) continue;
    if (!it) {
      it = state.items[id] = { id, kind: raw.kind, firstSeen: now };
      added.push(it);
    }
    Object.assign(it, { kind: raw.kind, name: str(raw.name || id), ok: !!raw.ok, detail: str(raw.detail), lastSeen: now, missing: false, missCount: 0 });
  }
  for (const it of Object.values(state.items)) {
    if (seen.has(it.id)) continue;
    it.missCount = it.missing ? (it.missCount || 0) + 1 : 1;
    it.missing = true;
  }
  if (added.length > 5) addEvent(state, `Discovered ${added.length} items`, 'info', now);
  else for (const it of added) addEvent(state, `New service discovered: ${it.name} (${it.kind})`, 'info', now);
}

export function mergeHomeHeartbeat(state, body, ip, now) {
  const b = body && typeof body === 'object' ? body : {};
  const host = str(b.host, 100).trim();
  if (!host) return false;
  state.home[host] = {
    host,
    os: str(b.os, 100),
    lanPiPing: !!b.lanPiPing,
    lanPiSsh: !!b.lanPiSsh,
    lanPiHttps: !!b.lanPiHttps,
    piLanIp: str(b.piLanIp, 60),
    ip: str(ip, 60),
    lastSeen: now,
  };
  return true;
}
