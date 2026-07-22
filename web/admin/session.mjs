// OnStandard — Command Center admin session hardening. Client-enforced idle + absolute timeout for the
// admin surface only (project-wide auth.sessions timeouts would also log out consumers). Pure decision
// is unit-tested; startSessionWatch wires it to real activity + signs out on expiry.

export function shouldExpire({ lastActivity, loginAt, now, idleMs, absoluteMs }) {
  if (now - loginAt >= absoluteMs) return 'absolute';
  if (now - lastActivity >= idleMs) return 'idle';
  return null;
}

export function startSessionWatch({ onExpire, idleMs = 30 * 60 * 1000, absoluteMs = 12 * 60 * 60 * 1000 }) {
  const loginAt = Date.now();
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  const events = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];
  events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
  const id = setInterval(() => {
    const why = shouldExpire({ lastActivity: last, loginAt, now: Date.now(), idleMs, absoluteMs });
    if (why) { stop(); onExpire(why); }
  }, 30 * 1000);
  function stop() {
    clearInterval(id);
    events.forEach((e) => window.removeEventListener(e, bump));
  }
  return stop;
}
