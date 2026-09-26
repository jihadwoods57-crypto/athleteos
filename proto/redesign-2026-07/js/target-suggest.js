/* Adaptive targets, the athlete's half (goals and eating plan, phase B, 2026-09-26).
 *
 * At app open (state.js _afterDayLoad, lazily) the device checks at most once a day whether a
 * suggestion is due, and files it (0253 target_suggestions) when it is. Plan > Today then shows:
 *   - a SOLO athlete (no team, no trainer): the suggestion itself, with Accept and Not now;
 *   - an athlete on a team or a trainer's client: "Your coach is reviewing a target change", and
 *     nothing they can press. They never self-accept (the database refuses it too).
 * The rules live in target-suggest-model.js (tested in Node). Deterministic, labelled "Suggested
 * change", never signed as Nia. Lazy: nothing here is in the boot graph.
 */
import { S, RT, act } from './state.js';
import { DAY } from './day.js';
import { icon } from './icons.js';
import { esc } from './components.js';
import { suggestTargets, suggestFamily, isLive, lastMoment, composeReason, composeIntuitive, liveMatches } from './target-suggest-model.js';

const store = () => { try { return window.localStorage; } catch { return null; } };
const CHECK_KEY = (uid) => `os.tsCheck.${uid}`;
const ROW_KEY = (uid) => `os.tsRow.${uid}`;
const todayISO = () => String(DAY.date);

/** The latest suggestion this athlete has, as last read. undefined = not read this session. */
let MINE = { uid: null, row: undefined, note: '', busy: false, flash: '' };

const cols = 'id,status,created_at,decided_at,current_protein,current_kcal,proposed_protein,proposed_kcal,pace_lb_wk,plan_lb_wk';

/** Who decides: 'self' for a solo athlete, 'coach' on a team, 'trainer' for a practice client. */
export function decider() {
  if (RT.myCoach && RT.myCoach.teamId) return 'coach';
  if (RT.myTrainer && RT.myTrainer.practiceId) return 'trainer';
  return 'self';
}

function remember(uid, row) {
  MINE = { ...MINE, uid, row: row || null };
  try { store().setItem(ROW_KEY(uid), JSON.stringify(row || null)); } catch { /* quota */ }
}

/** The latest row, from this session, else this phone, else null. */
export function mySuggestion() {
  const uid = RT.userId;
  if (MINE.uid === uid && MINE.row !== undefined) return MINE.row;
  let row = null;
  try { row = JSON.parse((store() && store().getItem(ROW_KEY(uid))) || 'null'); } catch { row = null; }
  MINE = { uid, row: row || null, note: '', busy: false, flash: '' };
  return MINE.row;
}

/** Read the latest row from the server: { ok, changed }. A failed read keeps what this phone has. */
async function readLatest() {
  const uid = RT.userId, sb = window.sb;
  if (!uid || !sb) return { ok: false, changed: false };
  try {
    const { data, error } = await sb.from('target_suggestions').select(cols)
      .eq('athlete_id', uid).order('created_at', { ascending: false }).limit(1);
    if (error) return { ok: false, changed: false };
    const row = Array.isArray(data) && data[0] ? data[0] : null;
    const before = JSON.stringify(mySuggestion());
    remember(uid, row);
    return { ok: true, changed: JSON.stringify(row) !== before };
  } catch { return { ok: false, changed: false }; }
}
/** For Plan > Today's mount: true when the row changed and the screen should repaint. */
export async function loadMySuggestion() { return (await readLatest()).changed; }

/** At app open: file a suggestion when one is due. Once a day per device; never throws. */
export async function maybeFileSuggestion() {
  const uid = RT.userId, sb = window.sb, s = store();
  if (!uid || !sb || !DAY.date) return null;
  const goal = (RT.profile && RT.profile.baseGoal) || null;
  const minor = !!(S.consent && S.consent.minor);
  if (minor || !suggestFamily(goal)) return null;
  if (s && s.getItem(CHECK_KEY(uid)) === todayISO()) return null;
  // The cadence needs the TRUE latest row: a failed read files nothing (the server would refuse a
  // second one inside 14 days anyway; this saves the round trip).
  if (!(await readLatest()).ok) return null;
  const rows = [...(DAY.scoreHistory || []).map((h) => ({ date: h.date, weight: h.weight }))];
  if (DAY.currentWeight != null) rows.push({ date: todayISO(), weight: DAY.currentWeight });
  // The protein basis is the STORED bodyweight (athlete_profiles.base_weight), the one 0253 checks
  // the per-pound rule against; with none stored, protein is never proposed.
  const base = RT.profile && RT.profile.baseWeight != null ? Number(RT.profile.baseWeight) : null;
  const sug = suggestTargets({
    goal, minor, rows, todayISO: todayISO(),
    current: { protein: DAY.proteinTarget, kcal: DAY.calTarget },
    basisLb: base > 0 ? base : null,
    lastAt: lastMoment(mySuggestion()),
  });
  try { s && s.setItem(CHECK_KEY(uid), todayISO()); } catch { /* quota */ }
  if (!sug) return null;
  try {
    const { data, error } = await sb.from('target_suggestions').insert({
      athlete_id: uid,
      current_protein: sug.currentProtein, current_kcal: sug.currentKcal,
      proposed_protein: sug.proposedProtein, proposed_kcal: sug.proposedKcal,
    }).select(cols).maybeSingle();
    if (error) return null;
    remember(uid, data || null);
    if (/^#plan(\/|$)/.test(location.hash) && window.__render) window.__render();
    return data || null;
  } catch { return null; }
}
/** Plan > Today's card. '' when there is nothing live to show. */
export function suggestionHtml() {
  const row = mySuggestion();
  if (!row || !isLive(row, todayISO())) {
    // A row this visit just closed (stale or expired) says so once, instead of vanishing.
    return MINE.flash ? `<div class="ts-wait" role="status">${icon('info', 16)}<span>${esc(MINE.flash)}</span></div>` : '';
  }
  const who = decider();
  if (who !== 'self') {
    return `<div class="ts-wait" role="status">${icon('clock', 16)}<span>Your ${who} is reviewing a target change.</span></div>`;
  }
  const PS = S.planStyle;
  const numbers = PS.showMacros || PS.showCalories;
  const bits = [];
  if (PS.showCalories && row.proposed_kcal !== row.current_kcal) bits.push(`${Number(row.current_kcal).toLocaleString('en-US')} to ${Number(row.proposed_kcal).toLocaleString('en-US')} calories`);
  if (PS.showMacros && row.proposed_protein !== row.current_protein) bits.push(`${row.current_protein}g to ${row.proposed_protein}g protein`);
  // Composed from the row's numbers (0253 stores no text). An Intuitive athlete sees no figure: the
  // change is described by what actually changes, never quoted.
  const reason = numbers ? composeReason(row) : composeIntuitive(row);
  return `<section class="ts-card" aria-label="Suggested change">
    <div class="ts-eb">Suggested change</div>
    ${bits.length ? `<div class="ts-t">${esc(bits.join(' · '))}</div>` : ''}
    ${reason ? `<p class="ts-why">${esc(reason)}</p>` : ''}
    <div class="ts-acts">
      <button type="button" class="btn ghost ts-no" id="ts-no"${MINE.busy ? ' disabled' : ''}>Not now</button>
      <button type="button" class="btn primary ts-yes" id="ts-yes"${MINE.busy ? ' disabled' : ''}>Use these</button>
    </div>
    ${MINE.note ? `<div class="ts-note" role="status">${esc(MINE.note)}</div>` : '<div class="ts-note">From your last three weeks of weigh-ins.</div>'}
  </section>`;
}

/** Wire Accept / Not now for a solo athlete. */
export function wireSuggestion(root) {
  const card = root.querySelector('.ts-card');
  if (!card) return;
  const decide = async (decision) => {
    const row = mySuggestion();
    if (!row || MINE.busy) return;
    MINE.busy = true; MINE.note = ''; window.__render();
    // Accepting a row whose numbers are no longer today's targets would apply a change to numbers
    // this athlete is not on: close it instead (the server re-checks the same thing).
    const stale = decision === 'approved' && !liveMatches(row, { protein: DAY.proteinTarget, kcal: DAY.calTarget });
    let status = null;
    try {
      const { data, error } = await window.sb.rpc('decide_target_suggestion', { p_id: row.id, p_decision: stale ? 'expire' : decision });
      status = error ? null : (stale ? 'stale' : data);
    } catch { status = null; }
    MINE.busy = false;
    if (!status) { MINE.note = 'Could not save that. Check your connection and try again.'; window.__render(); return; }
    MINE.flash = status === 'stale' ? 'Your targets changed since this was suggested, so nothing was changed.'
      : status === 'expired' ? 'That suggestion ran out after 14 days. Nothing was changed.' : '';
    remember(RT.userId, { ...row, status: status === 'stale' ? 'expired' : status, decided_at: new Date().toISOString() });
    // Accepted: the two numbers are now this athlete's own targets. Re-read them so the day is
    // graded on them at once (applyGoalToDay runs inside the profile hydrate).
    if (status === 'approved') { try { await act._loadProfileIntoRt(RT.userId); } catch { /* next launch */ } }
    window.__render();
  };
  const yes = card.querySelector('#ts-yes'), no = card.querySelector('#ts-no');
  if (yes) yes.addEventListener('click', () => { void decide('approved'); });
  if (no) no.addEventListener('click', () => { void decide('declined'); });
}
