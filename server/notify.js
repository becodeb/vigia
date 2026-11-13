// Decides which notification lines to emit for one evaluation. Mutates state.notify.
const MISS_THRESHOLD = 3;

export function evaluateNotifications(state, diag, piFresh) {
  const n = (state.notify ||= { fails: {}, alerted: {} });
  n.fails ||= {};
  n.alerted ||= {};
  const lines = [];

  // Overall change: must hold for 2 consecutive evaluations
  if (n.code === undefined) {
    n.code = diag.code;
    n.level = diag.level;
    if (diag.level !== 'ok') lines.push({ level: diag.level, text: `${diag.title}. ${diag.detail}` });
  } else if (diag.code !== n.code) {
    n.pend = n.pend && n.pend.code === diag.code ? { code: diag.code, n: n.pend.n + 1 } : { code: diag.code, n: 1 };
    if (n.pend.n >= 2) {
      lines.push({ level: diag.level, text: diag.level === 'ok' ? `Recovered: ${diag.title}` : `${diag.title}. ${diag.detail}` });
      n.code = diag.code;
      n.level = diag.level;
      n.pend = null;
    }
  } else {
    n.pend = null;
  }

  const check = (key, failing, failText, okText) => {
    if (failing) {
      n.fails[key] = (n.fails[key] || 0) + 1;
      if (n.fails[key] >= 2 && !n.alerted[key]) {
        n.alerted[key] = true;
        lines.push({ level: 'warn', text: failText });
      }
    } else {
      if (n.alerted[key]) lines.push({ level: 'ok', text: okText });
      delete n.fails[key];
      delete n.alerted[key];
    }
  };

  for (const it of Object.values(state.items || {})) {
    if (it.missing) {
      const key = `miss:${it.id}`;
        if ((it.missCount || 0) >= MISS_THRESHOLD && !n.alerted[key]) {
        n.alerted[key] = true;
        lines.push({ level: 'warn', text: `${it.name} disappeared from the Pi` });
      }
      continue;
    }
    delete n.alerted[`miss:${it.id}`];
    if (piFresh) check(`int:${it.id}`, !it.ok, `${it.name} is failing${it.detail ? ` (${it.detail})` : ''}`, `${it.name} recovered`);
    const ext = diag.items?.[it.id]?.externalOk;
    if (it.kind === 'web' && (ext === true || ext === false) && diag.code !== 'PATH_BROKEN') {
      check(`ext:${it.id}`, ext === false, `${it.name} fails from outside`, `${it.name} reachable from outside again`);
    }
  }
  // Forget keys of items that no longer exist
  const ids = new Set(Object.keys(state.items || {}));
  for (const store of [n.fails, n.alerted]) {
    for (const k of Object.keys(store)) if (!ids.has(k.slice(k.indexOf(':') + 1))) delete store[k];
  }
  return lines;
}
