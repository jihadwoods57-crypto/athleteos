/* The age check for a signed-in athlete with no age on record (review pass 2026-09-23, G-R5 /
 * A-B5).
 *
 * "Continue with Apple" (or Google) on the Sign-in screen could create an account that never
 * passed the date-of-birth step: Supabase makes the user on the first sign-in, and the app went
 * straight to Home. New identities are now sent through onboarding (signin.js), and this screen
 * catches everyone else the router finds signed in as an athlete with neither a birth date nor an
 * age on the server: an account made that way before the fix, or one whose onboarding answer
 * never reached the server.
 *
 * One question, the same rule as onboarding (ob-helpers ageBand, mirroring the server):
 *   under 13  the account cannot continue. Signed out, the "Not yet, but soon." screen with no way
 *             back to change the answer.
 *   13 to 17  saved, then the parent approval screen (#guardian): the minor's data stays on the
 *             phone until a parent says yes.
 *   18+       saved, then Home.
 * The server has the last word: set_my_dob (0210) refuses an under-13 date and never lets a
 * provable minor become an adult by retyping.
 */
import { RT, act, routeForRole } from '../state.js';
import { esc } from '../components.js';
import { dobFromParts, ageBand } from '../ob-helpers.js';

/* The age guard's fact (G-R5): does the server hold a birth date or age for this athlete? A
   confirmed NO sends the router here; a failed read decides nothing. M7: the role is confirmed on
   the server first, so a coach whose password sign-in fell back to 'athlete' is never asked. */
export async function checkAgeKnown() {
  const sb = window.sb;
  const uid = RT.userId;
  if (!sb || !uid) return;
  if (RT.authRole && RT.authRole !== 'athlete') { if (RT.ageKnown !== null) act.setAgeKnown(null); return; }
  try {
    const { data: pr, error: pe } = await sb.from('profiles').select('primary_role').eq('id', uid).maybeSingle();
    if (pe || RT.userId !== uid) return;
    if (pr && pr.primary_role && pr.primary_role !== 'athlete') {
      act.setAgeKnown(null, pr.primary_role); if (window.__render) window.__render(); return;
    }
    const { data, error } = await sb.from('athlete_profiles').select('dob,base_age').eq('athlete_id', uid).maybeSingle();
    if (error || RT.userId !== uid) return;
    const known = !!(data && (data.dob || data.base_age != null));
    if (RT.ageKnown === known) return;
    act.setAgeKnown(known);
    if (!known && window.__render) window.__render();
  } catch { /* unknown: the guard stays quiet */ }
}

let BUSY = false;
let ERR = '';

const todayISO = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

export default {
  hideTabs: true,
  anyRole: true,
  render() {
    return `
    <div class="ob">
      <div class="ob-nav"></div>
      <h1 class="ob-title">Your birth date</h1>
      <div class="ob-sub">Asked once. OnStandard is for ages 13 and up.</div>
      <div class="ob-body">
        <div class="dob-row">
          <input id="ac-m" class="ob-input" type="text" inputmode="numeric" maxlength="2" placeholder="MM" aria-label="Birth month" />
          <input id="ac-d" class="ob-input" type="text" inputmode="numeric" maxlength="2" placeholder="DD" aria-label="Birth day" />
          <input id="ac-y" class="ob-input" type="text" inputmode="numeric" maxlength="4" placeholder="YYYY" aria-label="Birth year" />
        </div>
        <div id="ac-err" class="ob-age-err" role="alert">${esc(ERR)}</div>
      </div>
      <div class="ob-foot">
        <button class="btn primary" id="ac-go" disabled>${BUSY ? 'Saving…' : 'Continue'}</button>
      </div>
    </div>`;
  },
  mount(root) {
    const m = root.querySelector('#ac-m'), d = root.querySelector('#ac-d'), y = root.querySelector('#ac-y');
    const go = root.querySelector('#ac-go');
    const err = root.querySelector('#ac-err');
    const digits = (el, n) => { const v = el.value.replace(/\D/g, '').slice(0, n); if (v !== el.value) el.value = v; };
    const read = () => {
      const dob = dobFromParts(m.value, d.value, y.value);
      return dob && dob <= todayISO() ? dob : null;
    };
    const sync = () => { go.disabled = BUSY || !read(); };
    m.addEventListener('input', () => { digits(m, 2); if (m.value.length >= 2) d.focus(); sync(); });
    d.addEventListener('input', () => { digits(d, 2); if (d.value.length >= 2) y.focus(); sync(); });
    y.addEventListener('input', () => { digits(y, 4); sync(); });
    go.addEventListener('click', async () => {
      const dob = read();
      if (!dob || BUSY) return;
      const band = ageBand(dob, todayISO());
      if (band === 'under13') {
        // Nothing is saved for a child. Sign out, scrub, and land on the blocked screen, which has
        // no way back to the question.
        try { await act.signOut(); } catch { /* the blocked screen still shows */ }
        act.captureOb({ ageLocked: true, dobBlocked: true, dob: null });
        location.hash = '#oba/blocked';
        return;
      }
      BUSY = true; ERR = ''; go.disabled = true; go.textContent = 'Saving…';
      const r = await act.setMyDob(dob);
      BUSY = false;
      if (!r.ok && r.reason !== 'locked') {
        ERR = r.reason === 'floor' ? 'OnStandard is for ages 13 and up.' : 'Couldn’t save that just now. Check your connection and try again.';
        if (err) err.textContent = ERR;
        go.textContent = 'Continue';
        sync();
        return;
      }
      act.noteAgeKnown(dob);
      location.hash = band === 'minor' ? '#guardian' : `#${routeForRole(RT.authRole || 'athlete')}`;
    });
    sync();
  },
};
