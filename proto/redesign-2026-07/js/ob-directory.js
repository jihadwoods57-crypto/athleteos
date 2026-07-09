/* Anonymous directory client for pre-account onboarding. All calls go through the
   org-directory edge function (the signed-out anon key can't call the authed RPCs).
   Every call can throw — callers degrade to code-entry / skip, never a dead end. */
async function invoke(body) {
  const sb = window.sb;
  if (!sb) throw new Error('offline');
  const { data, error } = await sb.functions.invoke('org-directory', { body });
  if (error || !data || data.error) throw new Error((data && data.error) || 'directory unavailable');
  return data;
}
export const dir = {
  search: (q) => invoke({ op: 'search', q }),
  teams: (org) => invoke({ op: 'teams', org }),
  practices: (q) => invoke({ op: 'practices', q }),
  previewCode: (code) => invoke({ op: 'preview_code', code }),
};
export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const CODE_RE = /^[A-Z0-9]{4,12}$/;
