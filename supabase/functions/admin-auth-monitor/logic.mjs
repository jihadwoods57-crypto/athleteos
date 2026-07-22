// Pure helpers for admin-auth-monitor — testable outside Deno.

// A temporary account ban fires only on a failed-attempt BURST (never on a single new-geo success).
export function classifyBurst(failures, windowMins, threshold = 10, window = 15) {
  return failures >= threshold && windowMins <= window;
}

// Parse an ipinfo.io response into {country, asn}. org looks like "AS15169 Google LLC".
export function geoFromIp(resp) {
  return { country: resp?.country ?? null, asn: (resp?.org ?? '').split(' ')[0] || null };
}

// Human-readable alert body for a flagged sign-in.
export function describeFlags(flags, ip, country) {
  const nice = { new_ip: 'new IP', new_country: 'new country', new_asn: 'new network',
    off_hours: 'unusual hour', impossible_travel: 'impossible travel' };
  const list = (flags || []).map((f) => nice[f] || f).join(', ');
  return `Suspicious Command Center sign-in (${list}) from ${ip || 'unknown IP'}${country ? ' · ' + country : ''}.`;
}
