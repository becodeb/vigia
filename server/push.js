import webpush from 'web-push';

export function createPush(cfg, state, log = console) {
  const enabled = !!(cfg.vapidPublic && cfg.vapidPrivate);
  if (enabled) webpush.setVapidDetails(cfg.vapidSubject, cfg.vapidPublic, cfg.vapidPrivate);
  else log.warn('VAPID keys missing: push disabled');

  async function sendAll(title, body) {
    if (!enabled || !state.push.length) return 0;
    const payload = JSON.stringify({ title, body });
    const dead = new Set();
    let sent = 0;
    await Promise.all(
      state.push.map(async (sub) => {
        try {
          await webpush.sendNotification(sub, payload, { TTL: 3600 });
          sent++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) dead.add(sub.endpoint);
          else log.warn(`push failed: ${e.statusCode || e.message}`);
        }
      }),
    );
    if (dead.size) state.push = state.push.filter((s) => !dead.has(s.endpoint));
    return sent;
  }

  function subscribe(sub) {
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) return false;
    state.push = state.push.filter((s) => s.endpoint !== sub.endpoint);
    state.push.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    if (state.push.length > 50) state.push.shift();
    return true;
  }

  return { enabled, sendAll, subscribe };
}
