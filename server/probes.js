import net from 'node:net';
import dns from 'node:dns/promises';

export async function probeWeb(host) {
  try {
    const res = await fetch(`https://${host}/`, {
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
      headers: { 'user-agent': 'vigia-probe/1' },
    });
    res.body?.cancel().catch(() => {});
    return { ok: res.status < 500, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e?.cause?.code || e?.name || 'error' };
  }
}

export function probeTcp(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok, detail) => {
      s.destroy();
      resolve({ ok, detail });
    };
    s.setTimeout(timeoutMs, () => done(false, 'timeout'));
    s.once('connect', () => done(true, 'connected'));
    s.once('error', (e) => done(false, e.code || 'error'));
  });
}

export async function probeDns(host) {
  try {
    const ips = await dns.resolve4(host);
    return { ok: ips.length > 0, ip: ips[0] || null };
  } catch {
    return { ok: false, ip: null };
  }
}

export async function runProbes(state, cfg, now = Date.now()) {
  const webs = Object.values(state.items).filter((i) => i.kind === 'web' && !i.missing);
  const [ssh, dnsRes, ...webRes] = await Promise.all([
    probeTcp(cfg.piHost, cfg.piSshPort),
    probeDns(cfg.piHost),
    ...webs.map((w) => probeWeb(w.id.replace(/^web:/, ''))),
  ]);
  state.probes = { ssh: { ...ssh, ts: now }, dns: { ...dnsRes, ts: now } };
  webs.forEach((w, i) => (w.ext = { ...webRes[i], ts: now }));
}
