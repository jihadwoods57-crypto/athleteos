/* OnStandard — Connected Standards, operator side (0155).
   Two screens plus the Home card:
     · standardsBoardCard()  — the live count on coach/trainer Home ("46 of 55 complete")
     · coachStandards        — the roster breakdown: who's short, who's waiting on a device,
                               who submitted by hand, and the staff actions for each
     · coachStandardEdit     — the builder

   ⚠ WHAT THE COACH SEES, AND ONLY THAT. The board payload (connected_standard_board, 0155)
   returns a status and a PERCENTAGE of the target the coach themselves set. There is no raw step
   count in it, no route, no workout time, no heart rate — the function is structurally incapable
   of returning them. A coach asked for 10,000 steps; they learn whether they got 10,000 steps.

   ⚠ AND NO PUBLIC RANKING. Individual status is staff-only by RLS, the rows are sorted by name
   rather than by performance, and there is no team-wide list of who came up short.

   nav:'operator' — one module renders for a coach's team AND a trainer's practice. */
import { icon } from '../icons.js';
import { track, EVENTS } from '../analytics.js';
import { backHead, esc, errorState } from '../components.js';
import { initialsOf } from '../initials.js';
import { RT } from '../state.js';
import { CD, bookId, loadBook, bookKindFor } from '../coach-data.js';
import { allowedCreateKeys, isReadonly } from '../staff-access.js';
import {
  boardCounts, needsAttention, csStatus, fmtValue, unitNoun,
  metricLabel, sourceRule, toCanonical, toDisplay,
} from '../connected-standards.js';
import {
  CS, loadBoard, loadOwnerStandards, saveStandard, setStandardActive,
  reviewManual, staffSetResult, todayISO,
} from '../connected-standard-data.js';

const PILL = { green: 'green', cyan: 'blue', blue: 'blue', purple: 'purple', amber: 'gold', red: 'red', slate: 'gray' };
const pillFor = (s) => PILL[csStatus(s).tone] || 'gray';

const hhmm = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const canSet = () => {
  if (CD.kind === 'practice') return true;              // a trainer owns their practice outright
  const role = CD.extras ? CD.extras.myRole : null;
  if (!CD.extras) return true;                          // never blank the menu on a slow fetch
  return !isReadonly(role) && allowedCreateKeys(role).includes('standards');
};

/* ---------------------------------------------------------------- the standing bar
   The coach surface already has an instrument for "what is the shape of my team right now": the
   Standing Bar from the Command Center pass (.co-standing / .co-legend in coach.css). Connected
   Standards uses it rather than inventing a second chart language, so this feature reads as part
   of the coach's dashboard instead of a bolt-on.

   ORDER IS BY PROPORTION, NOT BY SEVERITY. Leading with the exceptions would make a team that is
   54-for-55 look like a crisis every single evening, and a coach who learns the bar always opens
   red stops reading it. The bar answers "how did we do"; the sections below answer "who do I
   talk to". Each does exactly one job.

   The legend says what a person would say. A coach does not care that the enum reads
   'awaiting_sync' — they care that a phone hasn't reported. */
const SEGMENTS = [
  { key: 'complete', cls: 'g', dot: 'g', label: 'met' },
  { key: 'inProgress', cls: 'b', dot: 'b', label: 'still going' },
  { key: 'awaitingReview', cls: 'p', dot: 'p', label: 'waiting on you' },
  { key: 'gap', cls: 'a', dot: 'a', label: 'waiting on a device' },
  { key: 'missed', cls: 'r', dot: 'r', label: 'short' },
  { key: 'excused', cls: 'd', dot: 'd', label: 'excused' },
];

/** Fold the nine statuses into the six things a coach actually distinguishes. */
function segmentCounts(c) {
  return {
    complete: c.complete,
    inProgress: c.inProgress,
    awaitingReview: c.awaitingReview,
    gap: c.awaitingSync + c.disconnected + c.insufficient,
    missed: c.missed,
    excused: c.excused,
  };
}

function standingBar(c) {
  const s = segmentCounts(c);
  const total = SEGMENTS.reduce((t, x) => t + (s[x.key] || 0), 0);
  if (!total) return '';
  return `<div class="co-standing">${SEGMENTS
    .filter((x) => s[x.key] > 0)
    .map((x) => `<div class="seg ${x.cls}" style="flex:${s[x.key]}"></div>`).join('')}</div>`;
}

function standingLegend(c) {
  const s = segmentCounts(c);
  return `<div class="co-legend">${SEGMENTS
    .filter((x) => s[x.key] > 0)
    .map((x) => `<span class="it"><span class="dot ${x.dot}"></span><b>${s[x.key]}</b> ${esc(x.label)}</span>`)
    .join('')}</div>`;
}

/* ---------------------------------------------------------------- Home card */

/** '' when nothing is set today, so an operator who has never used this sees no change at all. */
export function standardsBoardCard() {
  const rows = CS.board;
  // Same honesty rule as the athlete card: a coach must never read "all clear" when the truth is
  // "we couldn't load the board". A wrong count is worse than no count.
  if ((!rows || !rows.length) && CS.boardError) {
    return `<section class="card pad" style="border-color:var(--amber-border);margin-bottom:10px">
      <div class="cs-h">Activity standards didn’t load</div>
      <div class="cs-p" style="padding-top:4px">This isn’t a count of zero. We couldn’t reach the server. Try again in a moment.</div>
    </section>`;
  }
  if (!rows || !rows.length) return '';
  return rows.map((inst) => {
    const c = boardCounts(inst.rows || []);
    if (!c.total) return '';
    const allIn = c.complete === c.total;
    // ONE chip, and only when something is genuinely waiting on this coach. A row of six
    // equal-weight status pills is a data dump wearing a summary's clothes — it hands the sorting
    // back to the person the screen is supposed to be sorting for.
    const waiting = c.awaitingReview;
    return `
    <section class="card pad cs-board" data-go="coach-standards/${esc(inst.instance_id)}">
      <div class="cs-board-head">
        ${/* NOT an h2: the whole card is data-go, and the router promotes every data-go element
              to role="button" — ARIA buttons flatten their children, so a heading in here would
              look done and read as nothing (same trap as the xcollapse summary). */''}
        <span class="cs-eyebrow">${esc(inst.title || 'Activity standard')}</span>
        <span class="cs-ask">${esc(`${fmtValue(inst.target, inst.metric, inst.display_unit)} ${unitNoun(inst.metric, inst.display_unit, inst.target)}`)}</span>
      </div>
      <div class="cs-count sm ${allIn ? 'done' : ''}">
        <span class="n">${c.complete}</span>
        <span class="u">of ${c.total} ${esc(inst.period === 'week' ? 'this week' : 'today')}</span>
        <span class="cs-grow"></span>
        ${waiting ? `<span class="xpill purple">${waiting} waiting on you</span>` : ''}
      </div>
      ${standingBar(c)}
    </section>`;
  }).join('');
}

/** Paint the board card into a slot on operator Home. Same async-slot seam Home uses elsewhere. */
export function paintStandardsBoard(root, slotId = '#cs-board-slot') {
  const slot = root.querySelector(slotId);
  if (!slot) return;
  const paint = () => { if (slot.isConnected) slot.innerHTML = standardsBoardCard(); };
  paint();
  const id = bookId();
  if (id) loadBoard(CD.kind === 'practice' ? null : id, CD.kind === 'practice' ? id : null).then(paint);
}

/* ---------------------------------------------------------------- the board */

function athleteRow(r, inst) {
  const st = csStatus(r.status);
  const pct = Math.max(0, Math.min(100, Number(r.progress_pct) || 0));
  // The sub-line names the REASON, so a coach never has to guess whether someone is slacking or
  // whether a phone is dead. These are very different conversations.
  // A verified row gets NO second line. "100% of target" beside a pill that already reads
  // Verified is the same fact twice, and across 46 of them it is the noise that buries the three
  // rows a coach actually has to read. Leaving it out makes the exceptions the only two-line
  // rows on the screen — they stand out because of what they are, not because of a colour.
  const why = r.status === 'awaiting_sync' ? `No data since ${hhmm(r.last_synced_at) || 'yesterday'}`
    : r.status === 'disconnected' ? 'Health access off'
    : r.status === 'insufficient_data' ? 'Never reported'
    : r.status === 'awaiting_review' ? esc(r.manual_note || 'Submitted by hand')
    : r.status === 'completed_manually' ? `Reported by the ${CD.noun}`
    : r.status === 'excused' ? esc(r.excused_reason || 'Excused')
    : r.status === 'verified_complete' ? ''
    : `${pct}% of target`;

  // The bar is drawn only where "how close did they get" is information. On a verified row it
  // would always be 100% and on an excused one it means nothing — a full-width green bar next to
  // a green pill is the same fact said twice.
  const showBar = r.status === 'in_progress' || r.status === 'missed';

  return `<div class="lrow" data-cs-row="${esc(r.result_id)}">
    <div class="lic cs-ini">${esc(initials(r.name))}</div>
    <div class="lm">
      <div class="lt">${esc(r.name || 'Athlete')}</div>
      ${why || r.disputed_at ? `<div class="ls">${why}${r.disputed_at ? `${why ? ' · ' : ''}disputed` : ''}</div>` : ''}
      ${showBar ? `<div class="cs-mini"><i style="width:${pct}%"></i></div>` : ''}
    </div>
    <span class="xpill ${pillFor(r.status)}">${esc(st.label)}</span>
  </div>`;
}

const initials = (name) => initialsOf(name, '?');

/* Signature of the board the screen last painted. See the loop note in mount(). */
let BOARD_SIG = null;

/* Direct entry — a relaunch restoring #coach-standards, or a typed link — reaches these mounts
   before any coach screen has fetched the book. bookId() is null then, and without this kick
   nothing ever loads it: the board sat on "Loading the board…" forever and the manage list swore
   the coach had no standards. The kick is all this does: loadBook dedupes in-flight and cached
   loads, and its own arrival hook (coach-data.js) repaints these hashes on success AND failure,
   so there is no repaint here to loop. Retrying past a cached failed load is the Retry button's
   job (bookRetry below), never the mount's — a mount that forces would refetch every repaint. */
export const ensureBook = () => {
  if (bookId()) return true;
  loadBook(false, bookKindFor(RT.authRole));
  return false;
};

/* The operator noun before the book has loaded: CD.bookWord follows the LOADED book's kind,
   which defaults to 'team' until then — a lie to a trainer on the failure path, where no
   arrival ever corrects the paint. The signed-in role is known before any fetch; use it. */
const bookWord = () => (bookKindFor(RT.authRole) === 'practice' ? 'practice' : 'team');
export const bookBack = () => (bookKindFor(RT.authRole) === 'practice' ? 'trainer' : 'coach-home');

/* The book itself couldn't load (or this account has none). One honest screen for the three
   book-less ways to land here, instead of a spinner that never resolves. */
export const bookless = (title, back) => {
  const offline = CD.roster && CD.roster.offline;
  return `${backHead(title, offline ? "Can't reach your " + bookWord() : 'Loading…', back)}
  ${offline ? `<div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
    <div class="sd-t">Can't reach your ${esc(bookWord())}</div>
    <div class="sd-s">Check your connection and try again. Nothing is lost.</div>
    <div class="sd-cta"><button class="btn primary sm" id="book-retry">Try again</button></div></div>`
  : CD.roster ? `<div class="state-demo"><div class="sd-ic">${icon('clipboard', 24)}</div>
    <div class="sd-t">No ${esc(bookWord())} yet</div>
    <div class="sd-s">Standards live on your ${esc(bookWord())}. Set one up first and the board opens here.</div></div>`
  : `<section class="card pad"><div class="cs-p">Loading…</div></section>`}`;
};

/* Wire bookless()'s Try again. A forced load punches through the cached offline ROSTER (the
   plain kick would early-return on it); the arrival hook repaints, so no .then here. */
export const wireBookRetry = (root) => {
  const rt = root.querySelector('#book-retry');
  if (rt) rt.addEventListener('click', () => { rt.disabled = true; loadBook(true, bookKindFor(RT.authRole)); });
};

export const coachStandards = {
  nav: 'operator',
  render({ sub }) {
    const back = bookBack();
    const inst = (CS.board || []).find((b) => b.instance_id === sub) || (CS.board || [])[0];
    if (!inst) {
      // No book means no board fetch ever started — that's a book problem, not a board one.
      if (!bookId()) return bookless('Activity standard', back);
      // Three honest states — this used to render "Loading…" forever when the board resolved
      // empty (nothing scheduled today / standard turned off) or errored.
      if (CS.boardError) {
        return `${backHead('Activity standard', "Can't reach the board", back)}
        ${errorState({ title: "Can't reach the board", body: 'Nothing is lost. Check your connection and try again.', retryId: 'cs-board-retry' })}`;
      }
      if (CS.boardAt) {
        return `${backHead('Activity standard', 'Nothing scheduled today', back)}
        <div class="state-demo"><div class="sd-ic">${icon('clipboard', 24)}</div>
        <div class="sd-t">No activity standard today</div>
        <div class="sd-s">When a standard is scheduled, everyone's verified results land here in real time.</div>
        <div class="sd-cta" style="margin-top:16px"><button class="btn primary sm" data-go="coach-standards-manage">${icon('clipboard', 16)} Manage standards</button></div></div>`;
      }
      return `${backHead('Activity standard', 'Loading…', back)}
      <section class="card pad"><div class="cs-p">Loading the board…</div></section>`;
    }
    const rows = inst.rows || [];
    const c = boardCounts(rows);
    // Three DIFFERENT asks, kept apart because they need different things from the coach:
    //   review   — an athlete submitted by hand and is waiting on a ruling
    //   disputed — an athlete says the verdict is wrong; a human has to answer them
    //   gaps     — the device never reported. NOT a miss, and not the athlete's doing.
    // Folding a disputed 'missed' into the gap group would file a verified shortfall under
    // "couldn't be verified", which is exactly the kind of quiet mislabel this feature must not
    // make about someone's record.
    const review = rows.filter((r) => r.status === 'awaiting_review');
    const disputed = rows.filter((r) => r.disputed_at && r.status !== 'awaiting_review');
    const gaps = needsAttention(rows).filter((r) =>
      r.status !== 'awaiting_review' && !r.disputed_at);
    const flagged = new Set([...review, ...disputed, ...gaps]);
    const rest = rows.filter((r) => !flagged.has(r));

    return `${backHead(inst.title || 'Activity standard', [
      inst.audience_label || (CD.kind === 'practice' ? 'All clients' : 'Entire team'),
      `${fmtValue(inst.target, inst.metric, inst.display_unit)} ${unitNoun(inst.metric, inst.display_unit, inst.target)}`,
    ].join(' · '), back)}

    <section class="card pad">
      <div class="cs-count ${c.complete === c.total ? 'done' : ''}">
        <span class="n">${c.complete}</span>
        <span class="u">of ${c.total} complete</span>
      </div>
      ${standingBar(c)}
      ${standingLegend(c)}
      ${inst.deadline_at ? `<div class="cs-p muted" style="margin-top:12px">Due by ${esc(hhmm(inst.deadline_at))}</div>` : ''}
    </section>

    ${!review.length && !disputed.length && !gaps.length ? `
    <section class="card pad">
      <div class="cs-clear">
        <div class="ic">${icon('check', 19)}</div>
        <div>
          <div class="cs-h">Nothing waiting on you</div>
          <div class="cs-p">Every ${CD.noun} either met this or has a reason on file.</div>
        </div>
      </div>
    </section>` : ''}

    ${review.length ? `
    <h2 class="eyebrow">Waiting on you · ${review.length}</h2>
    <section class="card" style="padding:2px 16px">${review.map((r) => `
      ${athleteRow(r, inst)}
      <div style="display:flex;gap:8px;padding:0 0 12px">
        <button class="btn primary sm" data-cs-ok="${esc(r.result_id)}" style="flex:1">Approve</button>
        <button class="btn ghost sm" data-cs-no="${esc(r.result_id)}" style="flex:1">Not this time</button>
      </div>`).join('')}
    </section>` : ''}

    ${disputed.length ? `
    <h2 class="eyebrow">Disputed · ${disputed.length}</h2>
    <section class="card" style="padding:2px 16px">${disputed.map((r) => `
      ${athleteRow(r, inst)}
      ${r.dispute_note ? `<div class="cs-p" style="padding:0 0 10px">“${esc(r.dispute_note)}”</div>` : ''}`).join('')}
    </section>
    <div class="cs-p" style="padding:8px 20px 0">Nothing changed on its own. The record still reads as it did. Correcting it is yours to do, and your name goes on it.</div>` : ''}

    ${gaps.length ? `
    <h2 class="eyebrow">Couldn’t be verified · ${gaps.length}</h2>
    <section class="card" style="padding:2px 16px">${gaps.map((r) => athleteRow(r, inst)).join('')}</section>
    <div class="sidebox" style="margin-top:12px">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 19)}</div>
      <div><div class="cs-h">These are device problems, not misses</div>
      <div class="cs-p">A phone that never reported produces no evidence either way, so these leave the completion rate entirely rather than counting against the athlete. Mark one missed only if you know the work wasn’t done.</div></div>
    </div>` : ''}

    ${rest.length ? `
    <h2 class="eyebrow">Roster</h2>
    <section class="card" style="padding:2px 16px">${rest.map((r) => athleteRow(r, inst)).join('')}</section>` : ''}

    <div class="cs-p" style="text-align:center;padding:14px 20px 24px">
      You see progress toward the target you set. Never anyone’s raw health data.
    </div>`;
  },

  mount(root, { sub }) {
    // Bail to the bookless paint only when there is ALSO no board to show — render paints a
    // board it already holds even if the roster cache was since lost (a failed forced reload
    // elsewhere), and bailing here would leave that board's Approve buttons dead.
    if (!ensureBook() && !(CS.board || []).length) { wireBookRetry(root); return; }
    const id = bookId();
    // ⚠ Repaint ONLY on a real change. __render() re-runs this mount, so an unconditional
    // refresh here is an infinite loop — and forcing the reload every pass never lets it settle.
    // Comparing a signature terminates after one repaint.
    if (id) loadBoard(CD.kind === 'practice' ? null : id, CD.kind === 'practice' ? id : null,
      todayISO()).then((rows) => {
      const sig = JSON.stringify((rows || []).map((b) => [b.instance_id,
        (b.rows || []).map((r) => `${r.result_id}:${r.status}:${r.progress_pct}`)]));
      if (sig === BOARD_SIG) return;
      BOARD_SIG = sig;
      if (root.isConnected && window.__render) window.__render();
    });

    // The failed-board retry: a forced reload, then repaint whatever came back.
    const boardRetry = root.querySelector('#cs-board-retry');
    if (boardRetry) boardRetry.addEventListener('click', async () => {
      boardRetry.disabled = true;
      const bid = bookId();
      if (bid) await loadBoard(CD.kind === 'practice' ? null : bid,
        CD.kind === 'practice' ? bid : null, todayISO(), true);
      if (window.__render) window.__render();
    });

    // A ruling that fails must SAY so: the old version discarded the result and reloaded,
    // so a dropped Approve looked processed and the row just came back. Now a failure
    // restores the button and prints why, and only a real success refreshes the board.
    const act = (attr, fn, busy) => root.querySelectorAll(`[${attr}]`).forEach((el) =>
      el.addEventListener('click', async () => {
        if (el.disabled) return;
        const label = el.textContent;
        el.disabled = true; el.textContent = busy;
        const r = await fn(el.getAttribute(attr));
        if (!r || !r.ok) {
          el.disabled = false; el.textContent = label;
          const wrap = el.parentElement;
          if (wrap && !(wrap.nextElementSibling && wrap.nextElementSibling.classList
            && wrap.nextElementSibling.classList.contains('cs-act-err'))) {
            wrap.insertAdjacentHTML('afterend',
              `<div class="cs-act-err" style="color:var(--red);font-size:var(--t-xs);font-weight:700;padding:0 0 10px">Couldn't save that ruling. Try again.</div>`);
          }
          return;
        }
        const bid = bookId();
        if (bid) await loadBoard(CD.kind === 'practice' ? null : bid,
          CD.kind === 'practice' ? bid : null, todayISO(), true);
        if (window.__render) window.__render();
      }));

    act('data-cs-ok', (rid) => reviewManual(rid, true).then((r) => {
      if (r.ok) track(EVENTS.CS_REVIEWED, { approve: true });
      return r;
    }), 'Approving…');
    act('data-cs-no', (rid) => reviewManual(rid, false).then((r) => {
      if (r.ok) track(EVENTS.CS_REVIEWED, { approve: false });
      return r;
    }), 'Saving…');
  },
};

/* ---------------------------------------------------------------- the builder */

const METRICS = [
  { key: 'steps', label: 'Steps', unit: 'steps', preset: 10000 },
  { key: 'distance', label: 'Distance', unit: 'mi', preset: 2.5 },
  { key: 'workouts', label: 'Workouts', unit: 'workouts', preset: 3 },
  { key: 'workout_minutes', label: 'Workout minutes', unit: 'min', preset: 150 },
  { key: 'active_minutes', label: 'Active minutes', unit: 'min', preset: 30 },
];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEADLINES = [
  { min: null, label: 'End of day' }, { min: 1020, label: '5:00 PM' },
  { min: 1140, label: '7:00 PM' }, { min: 1260, label: '9:00 PM' },
];

/* The coach standards editor's own switch (coach.css .std-switch), reused rather than reinvented
   so both builders feel like one product — and so the role="switch" a11y comes along for free. */
/* The WHOLE ROW is the control, not just the 50x30 pill. That clears the 44px touch floor without
   resizing a component the coach standards editor already ships, and it means the label is part
   of the target — which is what a screen reader announces and what a thumb actually hits. The
   pill itself is decorative and hidden from the accessibility tree. */
const sw = (key, on, title, sub) => `
  <div class="std-switch-row cs-sw-row" role="switch" tabindex="0"
       aria-checked="${on ? 'true' : 'false'}" data-cs-toggle="${esc(key)}">
    <div class="std-sw-m">
      <div class="std-sw-t">${esc(title)}</div>
      ${sub ? `<div class="std-sw-s">${esc(sub)}</div>` : ''}
    </div>
    <div class="std-switch ${on ? 'on' : ''}" aria-hidden="true"></div>
  </div>`;

/* The choice chips inside .cs-seg. They were bare <span>s with a click listener: no tab stop, no
   role, no checked state, so a keyboard or screen-reader user could not set the metric, the
   period, the days, or the deadline AT ALL — every knob in this editor except the switches above.
   screens.css even shipped a `.cs-seg span:focus-visible` outline, which nothing could ever
   trigger, so the intent was there and only the attributes were missing.

   `multi` picks the honest role: WHICH DAYS is a multi-select (checkbox), every other group is
   one-of-N (radio). Enter and Space are wired in mount() the same way the switch row does it. */
const chip = (attr, on, label, multi, name) => `
  <span class="${on ? 'on' : ''}" role="${multi ? 'checkbox' : 'radio'}" tabindex="0"
        aria-checked="${on ? 'true' : 'false'}"${name ? ` aria-label="${esc(name)}"` : ''} ${attr}>${esc(label)}</span>`;

let DRAFT = null;
const blank = () => ({
  id: null, metric: 'steps', display_unit: 'steps', target: 10000, period: 'day',
  repeat_days: [1, 2, 3, 4, 5], deadline_min: null, deliberate_workout: false,
  workout_min_duration_min: null, title: '', allow_manual: true,
  manual_requires_approval: false, audience_kind: 'team', audience_value: null,
});

export const coachStandardEdit = {
  nav: 'operator',
  render({ sub }) {
    const back = 'coach-standards-manage';
    if (!canSet()) {
      return `${backHead('Activity standard', 'View only', back)}
      <section class="card pad"><div class="cs-h">You can see these, not set them</div>
      <div class="cs-p" style="padding-top:4px">Your role can view the board. Ask a head coach to set or change a standard.</div></section>`;
    }
    if (!DRAFT || (sub && DRAFT.id !== sub)) {
      const def = sub ? (CS.defs || []).find((d) => d.id === sub) : null;
      DRAFT = def ? {
        id: def.id, metric: def.metric, display_unit: def.display_unit,
        target: toDisplay(def.target_value, def.metric, def.display_unit),
        period: def.period, repeat_days: def.repeat_days || [1, 2, 3, 4, 5],
        deadline_min: def.deadline_min, deliberate_workout: !!def.deliberate_workout,
        workout_min_duration_min: def.workout_min_duration_min,
        title: def.title || '', allow_manual: def.allow_manual !== false,
        manual_requires_approval: !!def.manual_requires_approval,
        audience_kind: def.audience_kind || 'team', audience_value: def.audience_value || null,
      } : blank();
    }
    const d = DRAFT;
    const preview = {
      metric: d.metric, display_unit: d.display_unit,
      target: toCanonical(d.target, d.metric, d.display_unit), progress: 0,
    };

    return `${backHead(d.id ? 'Edit standard' : 'New activity standard',
      CD.kind === 'practice' ? 'For your clients' : 'For your team', back)}

    <section class="card pad">
      <div class="cs-knob">
        <div class="cs-knob-label" id="cs-lb-metric">WHAT YOU’RE ASKING FOR</div>
        <div class="cs-seg" role="radiogroup" aria-labelledby="cs-lb-metric">${METRICS.map((m) =>
          chip(`data-cs-metric="${esc(m.key)}"`, m.key === d.metric, m.label)).join('')}
        </div>
      </div>

      ${d.metric === 'distance' ? `<div class="cs-knob">
        <div class="cs-knob-label" id="cs-lb-counts">WHAT COUNTS</div>
        <div class="cs-seg" role="radiogroup" aria-labelledby="cs-lb-counts">
          ${chip('data-cs-delib="0"', !d.deliberate_workout, 'Any walking or running')}
          ${chip('data-cs-delib="1"', !!d.deliberate_workout, 'A recorded workout')}
        </div>
        <div class="cs-p muted" style="margin-top:8px">${esc(sourceRule(d.metric, d.deliberate_workout, d.workout_min_duration_min))}</div>
      </div>` : ''}

      <div class="cs-knob">
        <label class="cs-knob-label" for="cs-target">TARGET</label>
        <input class="input" id="cs-target" type="number" inputmode="decimal" min="1" value="${esc(String(d.target))}">
        <div class="cs-p muted" style="margin-top:6px">${esc(unitNoun(d.metric, d.display_unit, 2))} per ${d.period === 'week' ? 'week' : 'day'}</div>
      </div>

      <div class="cs-knob">
        <div class="cs-knob-label" id="cs-lb-often">HOW OFTEN</div>
        <div class="cs-seg" role="radiogroup" aria-labelledby="cs-lb-often">
          ${chip('data-cs-period="day"', d.period === 'day', 'Every day')}
          ${chip('data-cs-period="week"', d.period === 'week', 'Across the week')}
        </div>
      </div>

      ${d.period === 'day' ? `
      <div class="cs-knob">
        <div class="cs-knob-label" id="cs-lb-days">WHICH DAYS</div>
        ${/* The visible initials repeat — S, T and S again — so each day carries its full name as
              its accessible name. "T" twice tells a screen-reader user nothing. */''}
        <div class="cs-seg" role="group" aria-labelledby="cs-lb-days">${DOW.map((lab, i) =>
          chip(`data-cs-dow="${i}"`, d.repeat_days.includes(i), lab, true, DOW_FULL[i])).join('')}
        </div>
      </div>
      <div class="cs-knob">
        <div class="cs-knob-label" id="cs-lb-due">DUE BY</div>
        <div class="cs-seg" role="radiogroup" aria-labelledby="cs-lb-due">${DEADLINES.map((x) =>
          chip(`data-cs-due="${x.min === null ? '' : x.min}"`, d.deadline_min === x.min, x.label)).join('')}
        </div>
      </div>` : ''}

      <div class="cs-knob">
        <div class="cs-knob-label">IF THE WATCH FAILS</div>
        ${sw('allow_manual', d.allow_manual, 'Allow manual backup',
          d.allow_manual
            ? 'An athlete whose device fails can log it by hand. It shows as reported rather than verified.'
            : 'Only device data will count. An athlete with a dead battery has no way to complete this.')}
        ${d.allow_manual ? sw('manual_requires_approval', d.manual_requires_approval,
          'Manual entries need my approval',
          'They wait in your review queue instead of counting straight away.') : ''}
      </div>

      <div class="cs-knob">
        <label class="cs-knob-label" for="cs-title">NAME IT</label>
        <input class="input" id="cs-title" maxlength="60" value="${esc(d.title)}" placeholder="${esc(defaultTitle(d))}">
      </div>
    </section>

    <h2 class="eyebrow">Athletes will see</h2>
    <section class="card cs-card">
      <div class="cs-row" style="padding-top:0">
        <div class="cs-top">
          <span class="cs-title">${esc((d.title || '').trim() || defaultTitle(d))}</span>
          <span class="xpill blue">In progress</span>
        </div>
        <div class="cs-bar"><i style="transform:scaleX(0)"></i></div>
        <div class="cs-nums"><span class="cs-prog">0 of ${esc(fmtValue(preview.target, d.metric, d.display_unit))} ${esc(unitNoun(d.metric, d.display_unit, preview.target))}</span></div>
        <div class="cs-meta">${esc(metricLabel(d.metric, d.deliberate_workout))} · Tracked, not scored</div>
      </div>
    </section>

    <div style="padding:12px 20px 0">
      <button class="btn" id="cs-save">${d.id ? 'Save changes' : 'Set this standard'}</button>
      ${d.id ? `<button class="btn ghost" id="cs-off" style="margin-top:8px">Turn this off</button>` : ''}
    </div>
    <div style="height:24px"></div>`;
  },

  mount(root) {
    // The builder renders fine from DRAFT alone, but Save needs the book id — kick the load now
    // (deduped if already in) so it's there before the coach finishes filling the form.
    ensureBook();
    const set = (patch) => { DRAFT = { ...DRAFT, ...patch }; if (window.__render) window.__render(); };

    /* No keydown wiring here on purpose. router.js promotes every .cs-seg chip to a tab stop and
       turns Enter/Space into a click centrally, and it restores focus across the repaint these
       knobs trigger. A second listener on the same chip fired click() TWICE per keypress, which
       toggled a day off and straight back on — the knob looked broken while being pressed
       correctly. One listener, in one place. */

    root.querySelectorAll('[data-cs-metric]').forEach((el) => el.addEventListener('click', () => {
      const m = METRICS.find((x) => x.key === el.getAttribute('data-cs-metric')) || METRICS[0];
      set({ metric: m.key, display_unit: m.unit, target: m.preset, deliberate_workout: false });
    }));
    root.querySelectorAll('[data-cs-delib]').forEach((el) => el.addEventListener('click', () =>
      set({ deliberate_workout: el.getAttribute('data-cs-delib') === '1' })));
    root.querySelectorAll('[data-cs-period]').forEach((el) => el.addEventListener('click', () =>
      set({ period: el.getAttribute('data-cs-period') })));
    root.querySelectorAll('[data-cs-due]').forEach((el) => el.addEventListener('click', () => {
      const raw = el.getAttribute('data-cs-due');
      set({ deadline_min: raw === '' ? null : Number(raw) });
    }));
    root.querySelectorAll('[data-cs-dow]').forEach((el) => el.addEventListener('click', () => {
      const i = Number(el.getAttribute('data-cs-dow'));
      const days = DRAFT.repeat_days.includes(i)
        ? DRAFT.repeat_days.filter((x) => x !== i) : [...DRAFT.repeat_days, i].sort();
      // A standard with no days would never materialize and would look broken rather than off.
      set({ repeat_days: days.length ? days : DRAFT.repeat_days });
    }));
    root.querySelectorAll('[data-cs-toggle]').forEach((el) => {
      const flip = () => set({ [el.getAttribute('data-cs-toggle')]: !DRAFT[el.getAttribute('data-cs-toggle')] });
      el.addEventListener('click', flip);
      // role="switch" + tabindex="0" promises keyboard operation; without this it only looks
      // focusable. Space and Enter are what a screen reader user will actually press.
      el.addEventListener('keydown', (ev) => {
        if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); flip(); }
      });
    });

    const target = root.querySelector('#cs-target');
    if (target) target.addEventListener('input', () => { DRAFT.target = Number(target.value) || 0; });
    const title = root.querySelector('#cs-title');
    if (title) title.addEventListener('input', () => { DRAFT.title = title.value; });

    const save = root.querySelector('#cs-save');
    if (save) save.addEventListener('click', async () => {
      if (save.disabled) return;
      const d = DRAFT;
      if (!(Number(d.target) > 0)) { save.textContent = 'Enter a target first'; return; }
      save.disabled = true; save.textContent = 'Saving…';
      const id = bookId();
      // No book id would file the standard against NULL — the insert fails silently server-side
      // and the coach's work vanishes. Refuse honestly, leave the draft intact, and force a
      // book refetch so "Try again" is a real offer, not a treadmill (the plain kick
      // early-returns on a cached failed load).
      if (!id) { loadBook(true, bookKindFor(RT.authRole)); save.disabled = false; save.textContent = 'Couldn’t save. Try again'; return; }
      const res = await saveStandard({
        id: d.id || undefined,
        team_id: CD.kind === 'practice' ? undefined : id,
        practice_id: CD.kind === 'practice' ? id : undefined,
        title: (d.title || '').trim() || defaultTitle(d),
        metric: d.metric, display_unit: d.display_unit,
        target_value: toCanonical(d.target, d.metric, d.display_unit),
        deliberate_workout: !!d.deliberate_workout,
        workout_min_duration_min: d.workout_min_duration_min || undefined,
        period: d.period,
        repeat_days: d.period === 'day' ? d.repeat_days : [0, 1, 2, 3, 4, 5, 6],
        deadline_min: d.deadline_min == null ? undefined : d.deadline_min,
        audience_kind: d.audience_kind, audience_value: d.audience_value || undefined,
        allow_manual: !!d.allow_manual,
        manual_requires_approval: !!d.manual_requires_approval,
      });
      if (res.ok) {
        track(EVENTS.CS_SET, { metric: d.metric, period: d.period, audience: d.audience_kind });
        DRAFT = null;
        location.hash = '#coach-standards-manage';
      } else {
        save.disabled = false;
        save.textContent = 'Couldn’t save. Try again';
      }
    });

    // Turning a standard off is two-tap, and the result is CHECKED: the old handler ignored
    // it and navigated, so a failed write left the standard live while the coach believed it
    // was off. On failure the button re-enables and says so instead of navigating.
    const off = root.querySelector('#cs-off');
    if (off) {
      let armed = false;
      off.addEventListener('click', async () => {
        if (off.disabled) return;
        if (!armed) { armed = true; off.textContent = 'Turn off this standard?'; return; }
        off.disabled = true; off.textContent = 'Turning off…';
        const r = await setStandardActive(DRAFT.id, false);
        if (!r || !r.ok) {
          off.disabled = false; armed = false;
          off.textContent = 'Couldn’t turn it off. Try again';
          return;
        }
        DRAFT = null;
        location.hash = '#coach-standards-manage';
      });
    }
  },
};

/* ---------------------------------------------------------------- manage list */

let MANAGE = { rows: [], loaded: false, error: false };

export const coachStandardsManage = {
  nav: 'operator',
  render() {
    const back = bookBack();
    // Last-known rows beat the bookless screen: the list is real data already fetched.
    if (!bookId() && !MANAGE.rows.length) return bookless('Activity standards', back);
    const rows = MANAGE.rows.filter((r) => r.active);
    return `${backHead('Activity standards', 'Verified from athlete devices', back)}
    ${MANAGE.error && !rows.length ? errorState({ title: "Couldn't load your standards", body: 'They are safe. Reconnect and they load right here.', retryId: 'cs-manage-retry' })
    : rows.length ? `<section class="card" style="padding:2px 16px">${rows.map((r) => `
      <div class="lrow" data-go="coach-standard-edit/${esc(r.id)}">
        <div class="lic" style="color:var(--blue-bright)">${icon('bolt', 18)}</div>
        <div class="lm">
          <div class="lt">${esc(r.title)}</div>
          <div class="ls">${esc(`${fmtValue(r.target_value, r.metric, r.display_unit)} ${unitNoun(r.metric, r.display_unit, r.target_value)} · ${r.period === 'week' ? 'per week' : 'per day'}`)}</div>
        </div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>`).join('')}</section>`
    : MANAGE.loaded ? `<section class="card pad">
        <div class="cs-h">No activity standards yet</div>
        <div class="cs-p" style="padding-top:4px">Set one and it verifies itself from your athletes’ phones and watches. No screenshots, no check-ins.</div>
      </section>`
    // Before the first fetch resolves this screen KNOWS NOTHING — "No activity standards yet"
    // here reads as a deletion to a coach who has three (the exact lie loadOwnerStandards'
    // contract exists to prevent). Loading is the only honest word.
    : `<section class="card pad"><div class="cs-p">Loading your standards…</div></section>`}
    ${canSet() ? `<div style="padding:12px 20px">
      <button class="btn" data-go="coach-standard-edit">Set a standard</button>
    </div>` : ''}
    <div style="height:20px"></div>`;
  },
  mount(root) {
    if (!ensureBook() && !MANAGE.rows.length) { wireBookRetry(root); return; }
    const id = bookId();
    if (id) loadOwnerStandards(CD.kind === 'practice' ? null : id, CD.kind === 'practice' ? id : null)
      .then((rows) => {
        if (rows === null) {
          // FAILED read: keep the last-known list, raise the flag once. The flag (not a
          // refetch) is what repaints, so a persistent outage cannot spin.
          if (!MANAGE.error) { MANAGE.error = true; if (root.isConnected && window.__render) window.__render(); }
          return;
        }
        const sig = rows.map((r) => `${r.id}:${r.active}`).join('|');
        const was = MANAGE.rows.map((r) => `${r.id}:${r.active}`).join('|');
        const cleared = MANAGE.error || !MANAGE.loaded; // first arrival must replace "Loading…"
        MANAGE.rows = rows; MANAGE.error = false; MANAGE.loaded = true;
        // Repaint only on a real change — __render re-runs this mount, so an unconditional
        // refresh here would spin forever.
        if ((sig !== was || cleared) && root.isConnected && window.__render) window.__render();
      });
    const retry = root.querySelector('#cs-manage-retry');
    if (retry) retry.addEventListener('click', () => {
      // A repaint re-runs this mount, and the mount always refetches.
      window.__render && window.__render();
    });
  },
};

function defaultTitle(d) {
  if (d.metric === 'steps') return d.period === 'week' ? 'Weekly Steps' : 'Daily Movement';
  if (d.metric === 'distance') return d.period === 'week' ? 'Weekly Distance' : 'Daily Distance';
  if (d.metric === 'workouts') return d.period === 'week' ? 'Weekly Workouts' : 'Daily Workout';
  return d.period === 'week' ? 'Weekly Activity' : 'Daily Activity';
}
