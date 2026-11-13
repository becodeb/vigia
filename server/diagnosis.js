// Pure diagnosis: (state, now, cfg) -> { level, code, title, detail, items }
export const PI_STALE_MS = 3 * 60 * 1000;
export const HOME_STALE_MS = 15 * 60 * 1000;
const EXT_STALE_MS = 5 * 60 * 1000;

export function fmtAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

// External result of a web item, or null when unknown/stale.
function extOf(item, now) {
  const e = item.ext;
  return e && typeof e.ok === 'boolean' && now - e.ts <= EXT_STALE_MS ? e : null;
}

function result(level, code, title, detail, items) {
  return { level, code, title, detail, items };
}

export function diagnose(state, now, cfg = {}) {
  const piHost = cfg.piHost || 'the Pi';
  const pi = state.pi || null;
  const all = Object.values(state.items || {});
  const live = all.filter((i) => !i.missing);
  const webs = live.filter((i) => i.kind === 'web');
  const piFresh = !!pi && now - pi.lastSeen <= PI_STALE_MS;
  const sshProbe = state.probes?.ssh && now - state.probes.ssh.ts <= EXT_STALE_MS ? state.probes.ssh : null;
  const dnsIp = state.probes?.dns?.ip || null;

  // Per-item status
  const items = {};
  for (const it of all) {
    const e = it.kind === 'web' ? extOf(it, now) : null;
    let status;
    if (it.missing) status = 'missing';
    else if (!piFresh) status = e ? (e.ok ? 'ok' : 'down') : 'unknown';
    else if (!it.ok) status = 'down';
    else if (e && !e.ok) status = 'warn';
    else status = 'ok';
    items[it.id] = { status, internalOk: it.missing || !piFresh ? null : !!it.ok, externalOk: e ? e.ok : null };
  }

  if (piFresh) {
    const internalFails = live.filter((i) => !i.ok);
    const extKnown = webs.map((w) => [w, extOf(w, now)]).filter(([, e]) => e);
    const extFails = extKnown.filter(([, e]) => !e.ok).map(([w]) => w);
    const internalWebOk = webs.length > 0 && webs.every((w) => w.ok);

    // 3. Everything outside fails while the Pi is fine
    if (internalWebOk && extKnown.length === webs.length && extFails.length === webs.length && sshProbe && !sshProbe.ok) {
      let why;
      if (!dnsIp) why = `DNS lookup of ${piHost} failed, so the DDNS record may be missing`;
      else if (pi.publicIp && dnsIp !== pi.publicIp) {
        why = `DDNS out of date: DNS says ${dnsIp}, Pi's real IP is ${pi.publicIp}`;
      } else {
        why = `port forwarding / router / ISP blocking (IP matches DNS: ${dnsIp})`;
      }
      return result('down', 'PATH_BROKEN', 'Pi is up but unreachable from the internet', why, items);
    }

    // 2. Something is broken on the Pi itself
    if (internalFails.length) {
      const list = internalFails.map((i) => `${i.name}${i.detail ? ` (${i.detail})` : ''}`).join(', ');
      return result('warn', 'SERVICES_DOWN', `${internalFails.length} service${internalFails.length > 1 ? 's' : ''} down on the Pi`, list, items);
    }

    // 4. Works inside, fails outside for some domains
    if (extFails.length) {
      const list = extFails.map((w) => `${w.name} fails from outside only (${w.ext.detail || 'no detail'})`).join('; ');
      return result('warn', 'EXTERNAL_PARTIAL', `${extFails.length} web app${extFails.length > 1 ? 's' : ''} unreachable from outside`, `${list}. Likely DNS/Cloudflare for that domain.`, items);
    }

    // 1. All good
    return result('ok', 'OK', 'Everything is working', `${live.length} items checked`, items);
  }

  // 5. Pi is silent
  const extAnswering = webs.filter((w) => extOf(w, now)?.ok);
  const lastPi = pi ? `Pi last reported ${fmtAge(now - pi.lastSeen)} ago` : 'Pi has never reported';
  if (extAnswering.length) {
    return result(
      'warn',
      'AGENT_SILENT',
      'Pi answers from outside but its agent is silent',
      `${lastPi}, yet ${extAnswering.length} of ${webs.length} web apps still answer externally. The agent or its cron job is broken.`,
      items,
    );
  }

  const hosts = Object.values(state.home || {});
  const fresh = hosts.filter((h) => now - h.lastSeen <= HOME_STALE_MS);
  const seen = hosts.length
    ? ` Last seen: ${hosts.map((h) => `${h.host} ${fmtAge(now - h.lastSeen)} ago`).join(', ')}.`
    : ' No home computer has ever reported.';
  const extLine = webs.length ? ' No web app answers from outside.' : '';

  if (fresh.length) {
    const reach = fresh.some((h) => h.lanPiPing || h.lanPiSsh || h.lanPiHttps);
    if (reach) {
      return result('down', 'PI_NO_INTERNET', 'Pi is on in the LAN but not reporting', `${lastPi}. Pi lost internet, or its agent cron is broken.${extLine}`, items);
    }
    return result('down', 'PI_OFF', 'Pi is off or hung', `${lastPi}. Home PCs are online but cannot reach it.${extLine}`, items);
  }
  return result(
    'down',
    'HOME_OFFLINE_OR_UNKNOWN',
    'Pi silent and no home computer reporting',
    `${lastPi}. Likely home internet or power outage (or the PCs are off).${extLine}${seen}`,
    items,
  );
}
