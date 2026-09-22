import { S, RT, tier } from '../state.js';
import { FILTERED_NOTE } from '../content-filter.js';
import { DAY, MEAL_KEYS } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg, emptyState, errorState, skeletonRows, segBar } from '../components.js';
import { tierColor, ON_STANDARD, qualityAccent } from '../score-band.js';
import { cachedMealPhoto, warmMealPhotos, resolveMealPhoto } from '../photo-store.js';
import { shortDate, weekdayLong } from '../fmt-date.js';
import { fetchRecentMeals, daysAgoISO, fetchMealComments, postMealComment, deleteMealComment, uploadChatPhoto, fetchThreadParticipants, signedMealPhotoUrl, signedMealPhotoUrls, notifyMyCoach } from '../roles.js';
import { attachedPhoto, isPhotoOnly, bubblePhotoHtml, hydrateThreadPhotos, wireComposerAttach, postChatMessage } from '../chat-attach.js';
import { threadMessages, reactionGroups, REACTION_EMOJI, normalizeDetected } from '../meal-intel.js';
import { wireTapback } from '../tapback.js';
import { mealReadHtml, wireReadControls } from './meal.js';
import { layoutThread, MUTED_HIDDEN_NOTE, authorName, initialsFor, isAnalysisUpdate, isEscalated, quotedFor,
  dayLabelOf, participantList, participantSummary, msgRowClass, timeSepHtml, deliveredHtml, msgTimeHtml, richText,
  correctionRowsOf,
} from '../chat-view.js';
import { openMembersSheet } from '../members-sheet.js';
import { decideAiTurn } from '../ai-thread.js';
import { hydrateAvatars } from '../avatar.js';

/* Message clock + day key for the past-meal conversation — local, so a message at 11:58pm and
   one at 12:01am are different days to the athlete whatever UTC thinks. */
const mvClock = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
};
const mvDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
import { composer } from '../components.js';
import { openImageViewer } from '../image-viewer.js';
import { wireReadMore } from '../thread-readmore.js';
import { focusComposer } from '../keyboard.js';

/* ---------- Trust Pass detail: the earned camera-free reward, rules visible (0196) ----------
   Two active shapes (credits / window) plus a not-earned state with real progress. The old decay
   curve modeled a single fixed 10-day window; neither surviving shape has a decay concept, so it
   is gone rather than adapted. */
export const trust = {
  tab: 'home',
  render() {
    const t = S.pass;
    if (!t.active) {
      const need = (RT.passPolicy || { eligibility_days: 7 }).eligibility_days;
      const have = Math.min(need, t.eligible || 0);
      const earned = have >= need;
      return `${backHead('Trust Pass', earned ? 'Earned, waiting on your coach' : 'Not earned yet')}
      <section class="card pad">
        <div style="font-size:17px;font-weight:800">${have} of ${need} photo-logged days</div>
        ${segBar(have, need, `${have} of ${need} photo-logged days`, 'margin:10px 0 6px')}
        <div style="font-size:12.5px;font-weight:600;color:var(--text-2)">${earned
          ? 'You have the days. Your coach can grant a pass any time from your profile.'
          : 'Show the pattern with photos first. Then your coach can give you camera-free meals, credited from your real history.'}</div>
      </section>`;
    }

    if (t.kind === 'credits') {
      return `
      ${backHead('Trust Pass', `${t.left} of ${t.total} camera-free meals left`)}
      ${t.note ? `<section class="card pad"><div style="font-size:13px;font-weight:600;color:var(--text-2);font-style:italic">"${esc(t.note)}"</div><div style="font-size:11.5px;font-weight:700;color:var(--text-3);margin-top:6px">FROM YOUR COACH</div></section>` : ''}
      <section class="card pad" style="border-color:var(--blue-border)">
        <div style="display:flex;align-items:center;gap:14px">
          <div class="req-icon b" style="width:52px;height:52px;border-radius:16px">${icon('shield', 26)}</div>
          <div style="flex:1">
            <div style="font-size:17px;font-weight:800">${t.left} left</div>
            <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:3px">Spend one on any meal from the hub. Expires ${esc(t.expires)}.</div>
          </div>
        </div>
      </section>

      <h2 class="eyebrow">How it scores</h2>
      <section class="card" style="padding:6px 16px">
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('bars', 17)}</div>
          <div class="lm"><div class="lt">Your trailing-10 median</div><div class="ls">Credit comes from your recent photo-earned days for that slot, up to the last 10. One hero plate can't inflate it, and a covered day never counts toward the median itself.</div></div>
        </div>
      </section>

      <h2 class="eyebrow">Change your mind</h2>
      <section class="card" style="padding:6px 16px">
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 17)}</div>
          <div class="lm"><div class="lt">Log it anyway</div><div class="ls">Take the photo and the pass comes straight back. Nothing is lost by logging.</div></div>
        </div>
      </section>
      <div style="height:10px"></div>
      `;
    }

    // window
    return `
    ${backHead('Trust Pass', `Day ${t.day} of ${t.length} · camera-free`)}
    ${t.note ? `<section class="card pad"><div style="font-size:13px;font-weight:600;color:var(--text-2);font-style:italic">"${esc(t.note)}"</div><div style="font-size:11.5px;font-weight:700;color:var(--text-3);margin-top:6px">FROM YOUR COACH</div></section>` : ''}
    <section class="card pad" style="border-color:var(--blue-border)">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="req-icon b" style="width:52px;height:52px;border-radius:16px">${icon('shield', 26)}</div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:800">Every meal is covered</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:3px">Nothing to tap. Your score keeps moving from your real logging history through ${esc(t.covers_until)}.</div>
        </div>
      </div>
    </section>

    <h2 class="eyebrow">How it scores</h2>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('bars', 17)}</div>
        <div class="lm"><div class="lt">Your trailing-10 median</div><div class="ls">Each meal credits your recent photo-earned days for that slot, up to the last 10. One hero plate can't inflate it, and a covered day never counts toward the median itself.</div></div>
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Streak detail: the honest streak, grace visible (spec §14) ----------
   Lives primarily in Progress (tab + back fallback); Profile keeps a shortcut. Grace is
   never framed as an easy alternative — the live line pushes finishing TODAY, and grace
   status is shown separately as a fact. */
export const streak = {
  tab: 'progress',
  render() {
    const cal = S.streakCalendar; // Monday→Sunday, real scores, grace marker
    const graceAvailable = S.streak.graceUsedRecently ? 0 : 1;
    return `
    ${backHead('Streak', `${S.streakDays} day${S.streakDays === 1 ? '' : 's'} on standard`, 'progress')}

    <section class="card pad" style="text-align:center">
      <div style="display:inline-flex;align-items:center;gap:10px">
        <span style="color:var(--amber-bright)">${icon('flame', 26)}</span>
        <span style="font-size:52px;font-weight:800;letter-spacing:-0.04em">${S.streakDays}</span>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text-2);margin-top:4px">days at 80 or better</div>
      ${S.score >= ON_STANDARD
        ? `<div style="font-size:12.5px;font-weight:600;color:var(--green-bright);margin-top:10px">Today is above the bar.${S.streakDays > 0 ? ` Day ${S.streakDays} locks at midnight.` : ' Your streak starts when today locks at midnight.'}</div>`
        : `<div style="font-size:12.5px;font-weight:600;color:var(--amber-bright);margin-top:10px">Today is still live. Reach 80 before the day closes to continue your streak.</div>`}
      <div style="font-size:12px;font-weight:700;color:var(--text-2);margin-top:8px">Weekly grace available: ${graceAvailable}${graceAvailable ? '' : ` · used ${S.streak.label.replace('grace used ', '')}`}</div>
    </section>

    <h2 class="eyebrow">This week</h2>
    <section class="card pad">
      <div class="stk-week">
        ${cal.map(x => `
          <div class="stk-day ${x.on ? 'on' : x.future ? 'future' : x.today ? '' : 'miss'}${x.today ? ' today' : ''}">
            <span class="d">${x.label}</span>
            <span class="s">${x.score != null ? x.score : '—'}</span>
            ${x.grace ? '<span class="g">Grace</span>' : ''}
          </div>`).join('')}
      </div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:14px">Your real day scores, Monday through Sunday. A day under 80 ends the run unless your weekly grace bridges it. Grace applies only after the day closes.</div>
    </section>

    <h2 class="eyebrow">The rules</h2>
    <section class="card" style="padding:6px 16px" role="list">
      <div class="lrow" role="listitem" style="cursor:default">
        <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('target', 17)}</div>
        <div class="lm"><div class="lt">80 is the bar</div><div class="ls">On standard means 80+. Not close, not almost.</div></div>
      </div>
      <div class="lrow" role="listitem" style="cursor:default">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('shield', 17)}</div>
        <div class="lm"><div class="lt">One grace per rolling 7 days</div><div class="ls">A single miss is bridged after the day closes: the chain survives, the day never counts. A second miss inside the week ends the run.</div></div>
      </div>
      <div class="lrow" role="listitem" style="cursor:default">
        <div class="lic" style="background:var(--amber-surface);color:var(--amber-bright)">${icon('clock', 17)}</div>
        <div class="lm"><div class="lt">Absent days count as misses</div><div class="ls">Not opening the app isn't a loophole. The calendar is the judge.</div></div>
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Activity History: the real proof trail across days (spec §15) ----------
   Real `meals` rows (photo, name, logged time, on-time/late, meal score /100) grouped by
   day under the day's real score. Today's meals open the live meal thread; past meals open
   the read-only meal view. One name everywhere: Activity History. */

let HIST = { rows: null, at: 0, uid: null, failed: false }; // fetched meals cache (session; 60s freshness)
export function histMealById(id) {
  return (HIST.rows || []).find((m) => String(m.id) === String(id)) || null;
}

/* What that DAY had banked by the time this plate landed, this plate included — the figure the
   read card's "That day after this meal" bars measure. The live day has S.dayTotalsThrough for
   this; a past day has only the stored rows, and they are enough: same day_date, logged no later
   than this one. Without it the bars printed the single plate's macros against the whole day's
   target (fixed 2026-09-16), which read as the day going backwards from one meal to the next.

   Null, never a zero, whenever the day cannot be known:
     - the row carries no logged time, so there is no moment to count through;
     - the history has not been fetched (HIST.rows is null), which is the state this screen is in
       when a notification opens one meal DIRECTly. Summing an unfetched cache returned a confident
       0g for a plate holding 52 — the same class of lie as `meal.carbs || 0`, and this screen is
       where that one was found. The plate itself is always counted; only the OTHER plates of that
       day come from the cache, so a loaded day with nothing else in it honestly totals this one. */
function pastDayTotalsThrough(m) {
  if (!m || !m.logged_at || !m.day_date || !HIST.rows) return null;
  const cut = new Date(m.logged_at).getTime();
  if (isNaN(cut)) return null;
  let protein = m.protein || 0, kcal = m.kcal || 0;
  for (const r of HIST.rows) {
    if (!r || String(r.id) === String(m.id)) continue;
    if (String(r.day_date) !== String(m.day_date)) continue;
    const at = r.logged_at ? new Date(r.logged_at).getTime() : NaN;
    if (isNaN(at) || at > cut) continue;
    protein += r.protein || 0;
    kcal += r.kcal || 0;
  }
  return { protein: Math.round(protein), cals: Math.round(kcal) };
}

const fmtLoggedAt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  let h = d.getHours() % 12; if (h === 0) h = 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

function histCard(m, isToday) {
  const img = m.photo_path ? cachedMealPhoto(m.photo_path) : null;
  const late = typeof m.minutes_late === 'number' && m.minutes_late > 0;
  const time = fmtLoggedAt(m.logged_at);
  const route = isToday && MEAL_KEYS.includes(m.type) ? `meal-detail/${m.type}` : `meal-view/${m.id}`;
  return `<div class="hist-card" data-go="${route}">
    ${img && safeImg(img)
      ? `<div class="hist-thumb" style="background-image:url('${safeImg(img)}')"></div>`
      : `<div class="hist-thumb icon">${icon('utensils', 20)}</div>`}
    <div class="hist-main">
      <div class="t">${esc(m.name || (m.type ? m.type.charAt(0).toUpperCase() + m.type.slice(1) : 'Meal'))}</div>
      <div class="s">${time ? `${time} · ` : ''}${late ? `${m.minutes_late} min late` : 'On time'}${m.photo_path ? '' : ' · No photo submitted'}</div>
    </div>
    ${m.quality != null ? `<div class="hist-score ${qualityAccent(m.quality)}">${m.quality}<small>/100</small></div>` : ''}
    ${icon('chevron', 15, 'style="color:var(--text-3);flex:none"')}
  </div>`;
}

export const history = {
  tab: 'progress',
  render() {
    const dayHead = (label, score, tierName) => `
      <h2 class="eyebrow" style="display:flex;justify-content:space-between;align-items:baseline">
        <span>${label}</span>
        ${score != null ? `<span style="text-transform:none;letter-spacing:0;font-size:13px;font-weight:800;color:${tierColor(score)}">${score}${tierName ? ` · ${tierName}` : ''}</span>` : ''}
      </h2>`;
    const todayLabel = `Today · ${weekdayLong(new Date())}`;
    const rows = HIST.rows;
    let body;
    if (HIST.failed && rows === null) {
      // A dropped request must not claim "your proof trail builds here" over a real record.
      body = errorState({
        title: "Couldn't load your history",
        body: 'Your logged meals are safe on the server. Reconnect and they load right here.',
        retryId: 'hist-retry',
      });
    } else if (rows === null) {
      body = skeletonRows(4, 'Loading your history');
    } else if (!rows.length) {
      body = emptyState({
        icon: 'clipboard',
        title: 'Your proof trail builds here',
        body: 'Every meal you log, with its photo, time and score, becomes part of your record.',
        action: { label: 'Log a meal', go: 'camera' },
      });
    } else {
      const scoreBy = {};
      for (const h of S.history) scoreBy[h.iso] = h;
      const todayISO = String(DAY.date);
      const groups = [];
      for (const m of rows) {
        const g = groups.find((x) => x.date === m.day_date);
        if (g) g.meals.push(m); else groups.push({ date: m.day_date, meals: [m] });
      }
      body = groups.map((g) => {
        const isToday = g.date === todayISO;
        const label = isToday ? todayLabel : `${weekdayLong(g.date)} · ${shortDate(g.date)}`;
        const h = scoreBy[g.date];
        const score = isToday ? S.score : (h ? h.score : null);
        const tierName = isToday ? S.tier.name : (h ? h.tier : null);
        return dayHead(label, score, tierName) + `<section class="card" style="padding:4px 12px">${g.meals.map((m) => histCard(m, isToday)).join('')}</section>`;
      }).join('');
    }
    return `
    ${backHead('Activity history', 'The proof trail, day by day', 'progress')}
    ${body}
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    // Fetch real meal rows (14 days) once per minute per user; repaint when they land, then
    // warm photo signed-URLs (second repaint when those resolve). Both best-effort.
    if (!RT.userId) return;
    const retry = root && root.querySelector('#hist-retry');
    if (retry) retry.addEventListener('click', () => { HIST = { rows: null, at: 0, uid: null, failed: false }; window.__render(); });
    const fresh = HIST.uid === RT.userId && Date.now() - HIST.at < 60000;
    if (fresh) {
      warmMealPhotos((HIST.rows || []).map((m) => m.photo_path).filter(Boolean));
      return;
    }
    fetchRecentMeals(RT.userId, daysAgoISO(14)).then((rows) => {
      // null = the fetch FAILED: keep last-known rows if this session has any (stamped stale so
      // the next visit retries); only show the error state when there is nothing real to show.
      if (rows === null) {
        const keep = HIST.uid === RT.userId ? HIST.rows : null;
        HIST = { rows: keep, at: 0, uid: RT.userId, failed: true };
      } else {
        HIST = { rows, at: Date.now(), uid: RT.userId, failed: false };
        warmMealPhotos(rows.map((m) => m.photo_path).filter(Boolean));
      }
      if (location.hash.startsWith('#history')) window.__render();
    });
  },
};

/* ---------- Read-only meal view for PAST days (spec §15.3) ----------
   Renders the fetched meals row: photo (full-screen viewer), quality, foods, macros, the
   AI analysis, and the athlete's note. Today's meals use the live thread instead. */
/* A meal fetched directly by id. The AI's daily follow-up deep-links straight here from a push,
   which can land long before the history cache is warm — without this the athlete taps a message
   about their dinner and gets "Couldn't open this meal". */
let DIRECT = { id: null, row: null };
// Long AI bubbles the athlete has expanded, keyed on each bubble's own text head. Module scope so
// an expansion survives this screen's repaints (see thread-readmore.js).
const EXPANDED_BUBBLES = new Set();
/* Warm the history cache from a screen that did not come through History. The day bars on a past
   plate need that day's OTHER rows, and a deep link from a push lands here with the cache cold —
   pastDayTotalsThrough returns null rather than guess, so without this the bars simply never
   appear for the athlete who arrived by notification. Same fetch, same 14-day window and same
   cache shape the History screen uses; a failure is silent, because the bars standing down is
   already the honest fallback. */
async function warmHistory() {
  if (!RT.userId || HIST.rows || HIST.uid === RT.userId) return;
  HIST = { ...HIST, uid: RT.userId };
  const rows = await fetchRecentMeals(RT.userId, daysAgoISO(14));
  if (rows === null) { HIST = { rows: null, at: 0, uid: RT.userId, failed: true }; return; }
  HIST = { rows, at: Date.now(), uid: RT.userId, failed: false };
  if (window.__render) window.__render();
}

async function fetchMealById(id) {
  if (!id || !window.sb || DIRECT.id === id) return;
  try {
    const { data } = await window.sb.from('meals')
      .select('id,athlete_id,type,name,quality,protein,carbs,fat,kcal,detected,note,analysis,photo_path,day_date,logged_at,minutes_late')
      .eq('id', id).maybeSingle();
    DIRECT = { id, row: data || null };
    if (data) window.__render && window.__render();
  } catch { /* the empty state below is honest */ }
}

/* The conversation on a past meal. Same rows as the live thread (meal_comments), same rules —
   the AI reply is written server-side by meal-chat, so we post the athlete's message and REFETCH
   rather than appending a reply the server has not confirmed. */
function mountThread(root, mealId, meal) {
  const threadEl = root.querySelector('#mv-thread');
  const input = root.querySelector('#mv-msg');
  const send = root.querySelector('#mv-send');
  const note = root.querySelector('#mv-note');
  if (!threadEl) return;
  let rows = [];

  // Same conversation, same treatment as the live thread. This screen is where an athlete lands
  // from a follow-up notification about a past meal, so it must not be the one place the room
  // still reads as "Coach" with a hardcoded letter for a face.
  let participants = [];
  const paint = () => {
    const msgs = threadMessages(rows);
    if (!msgs.length) { threadEl.innerHTML = '<div class="msg-status">No messages on this meal yet.</div>'; return; }
    // `muted` here too: this is the fourth layoutThread caller, and it renders the SAME
    // meal_comments rows as the live thread — a mute that held there and lapsed here would
    // resurface the blocked person on the screen a follow-up notification lands on (1.2).
    const items = layoutThread(msgs, { muted: RT.mutedUsers, fmtTime: mvClock, fmtDay: mvDay, fmtDayLabel: dayLabelOf });
    // Everyone who wrote here is muted: say that, plainly. "No messages yet" would be a lie,
    // and a silent blank region reads as a broken screen.
    if (!items.length) { threadEl.innerHTML = `<div class="msg-status">${MUTED_HIDDEN_NOTE}</div>`; return; }
    // Reactions are keyed to the MEAL, not a message (0049) — same rule as the live thread:
    // they sit once, on the last bubble, where the eye lands.
    const msgItems = items.filter((i) => i.type !== 'time');
    const lastMsg = msgItems.length ? msgItems[msgItems.length - 1].comment : null;
    // The painted messages, for the quote stems below: quoting from the PRE-filter list let a
    // correction reply paint a muted person's words inside its stem — the block failing an inch
    // under the bubble it hid. No quote at all is the honest render of a hidden source.
    const visible = msgItems.map((i) => i.comment);
    threadEl.innerHTML = items.map((item) => {
      if (item.type === 'time') return timeSepHtml(item, esc);
      const c = item.comment;
      /* A filed correction receipt renders as the card, not as a bubble — the same record the
         athlete sees in their own thread (chat-view isCorrectionReceipt). */
      const receiptRows = correctionRowsOf(c);
      if (receiptRows.length) {
        return `
      <div class="msg ai last">
        <div class="av">${icon('sparkle', 15)}</div>
        <div class="corr-card in landed" role="status">
          <div class="corr-head">${icon('check', 14)}<span>Updated</span></div>
          ${receiptRows.map((r) => `
            <div class="corr-row${r.score ? ' corr-score' : ''}">
              <span class="ck">${esc(r.label)}</span>
              <span class="cv"><i class="was">${esc(String(r.from) + r.unit)}</i>${icon('arrowRight', 12)}<b class="${esc(r.band)}">${esc(String(r.to) + r.unit)}</b></span>
            </div>`).join('')}
        </div>
      </div>`;
      }
      const mine = c.role === 'athlete' && (!c.author_id || c.author_id === RT.userId);
      const who = authorName(c, participants, RT.userId, S.coach.noun);
      const update = isAnalysisUpdate(c);
      const escalated = isEscalated(c);
      const quoted = update ? quotedFor(c, visible) : null;
      const photo = attachedPhoto(c);
      const photoOnly = isPhotoOnly(c);
      const rx = c === lastMsg ? reactionGroups(rows) : [];
      // The face rides the LAST bubble of a run, the name the first (chat-view.js msgRowClass;
      // `last` carries the tail).
      return `
        <div class="${msgRowClass({ mine, role: c.role, firstOfRun: item.firstOfRun, lastOfRun: item.lastOfRun, hasRx: rx.length > 0, photoOnly })}">
          ${!mine && item.lastOfRun ? `<div class="av"${c.role !== 'ai' && c.author_id ? ` data-avatar-uid="${esc(c.author_id)}"` : ''}>${c.role === 'ai' ? icon('sparkle', 15) : `<span data-avatar-fallback>${esc(initialsFor(who))}</span>`}</div>` : '<div class="av-sp"></div>'}
          <div class="stack">
            ${item.firstOfRun && !mine ? `<div class="who">${esc(who)}</div>` : ''}
            ${quoted ? `<div class="quote"><span class="stem"></span><span class="qtext">${esc(quoted.text)}</span></div>` : ''}
            ${/* No "Updated analysis" badge on correction replies (founder: robotic; the live
                  thread already dropped it) — the quote stem above says what it answers. */''}
            <div class="bubble">${escalated ? '<span class="esc">Sent to your coach</span>' : ''}${bubblePhotoHtml(photo, esc)}${photoOnly ? '' : c.role === 'ai' ? richText(c.text, esc) : esc(String(c.text || ''))}${rx.length ? `<span class="rxo">${rx.map((r) => `${esc(r.emoji)} ${r.count}`).join(' ')}</span>` : ''}</div>
            ${deliveredHtml({ mine, isLast: c === lastMsg })}
          </div>
          ${msgTimeHtml(c, mvClock, esc)}
        </div>`;
    }).join('');
    // Resolve any attachments just painted. trust.js imports named roles functions rather than the
    // module, so the helper is handed the one function it needs.
    void hydrateThreadPhotos(threadEl, { signedMealPhotoUrl, signedMealPhotoUrls });
    hydrateAvatars(threadEl);   // 0206: message monograms upgrade to real faces, as on the meal thread
    // The same Read more the meal thread has. This screen renders the identical AI opener, which
    // meal-opener.ts composes assuming a client clamp exists.
    wireReadMore(threadEl, EXPANDED_BUBBLES);
  };

  // Tap an attached photo to open it full-screen. Delegated: every repaint replaces the <img>.
  threadEl.addEventListener('click', (ev) => {
    const im = ev.target && ev.target.closest ? ev.target.closest('img.bimg') : null;
    if (!im || !im.src) return;
    openImageViewer(im.src, 'Photo attached to this message', im);
  });

  /* Who can read the room — the same facepile header the live thread wears (meal.js). A composer
     with no audience disclosure is a privacy problem: an athlete answering a follow-up about a
     past meal deserves to know, before they hit send, that their coach and their mother can both
     read the reply. Painted when the participant fetch lands; repainted only if the list changes.
     The sheet it opens is disclosure only (members-sheet.js). */
  const membersSlot = root.querySelector('#mv-members-slot');
  let membersPainted = -1;
  const paintMembers = () => {
    if (!membersSlot) return;
    const people = participantList(participants, RT.userId);
    if (people.length === membersPainted) return;
    membersPainted = people.length;
    // The same one-row header the meal page's Team discussion wears: faces, title, who is in it.
    membersSlot.innerHTML = `
      <button class="facepile disc-fp" id="mv-members" aria-label="Who can see this conversation">
        <span class="fp">${people.slice(0, 4).map((p) => `<span class="fpav ${esc(p.kind === 'ai' ? 'ai' : p.self ? 'self' : 'other')}"${p.kind !== 'ai' && p.id ? ` data-avatar-uid="${esc(p.id)}"` : ''}>${p.kind === 'ai' ? icon('sparkle', 13) : `<span data-avatar-fallback>${esc(initialsFor(p.name))}</span>`}</span>`).join('')}</span>
        <span class="names"><b>Team discussion</b><small>${esc(participantSummary(people))}</small></span>
      </button>`;
    const btn = membersSlot.querySelector('#mv-members');
    if (btn) btn.addEventListener('click', () => openMembersSheet(participantList(participants, RT.userId)));
    hydrateAvatars(membersSlot);   // faces answer "who can read this" faster than monograms (0206)
  };

  const refresh = async () => {
    const [fetched, people] = await Promise.all([
      fetchMealComments(mealId).catch(() => []),
      participants.length ? Promise.resolve(participants) : fetchThreadParticipants(RT.userId).catch(() => []),
    ]);
    rows = Array.isArray(fetched) ? fetched : [];
    participants = Array.isArray(people) ? people : [];
    if (root.isConnected) { paintMembers(); paint(); }
  };
  void refresh();

  // Press-and-hold reactions — this screen is where follow-up pushes land, so a coach's ❤️ on
  // yesterday's dinner must be visible (and answerable) HERE, not only on the live thread.
  // wireTapback is re-entrant; '#mv-thread' scopes it away from the other two renderers.
  let rxBusy = false;
  wireTapback({
    root,
    scope: '#mv-thread',
    emoji: REACTION_EMOJI,
    mine: () => new Set((rows || [])
      .filter((c) => c && c.kind === 'reaction' && c.author_id === RT.userId)
      .map((c) => String(c.text))),
    onReact: async (emoji) => {
      if (!emoji || rxBusy) return;
      rxBusy = true;
      // TOGGLE, not append — mirrors meal.js: reaction rows are exempt from the message cap, so
      // an un-toggled control would let one athlete write unbounded rows.
      const existing = (rows || []).find((c) => c && c.kind === 'reaction' && c.author_id === RT.userId && String(c.text) === emoji);
      const ok = existing
        ? await deleteMealComment(existing.id).catch(() => false)
        : await postMealComment(mealId, meal.athlete_id || RT.userId, RT.userId, 'athlete', emoji, 'reaction').catch(() => false);
      if (ok) await refresh(); else if (note) note.textContent = "Couldn't save that reaction. Try again.";
      rxBusy = false;
    },
  });

  // Photo attachment — same shared plumbing as the live and coach threads (chat-attach.js), so
  // the three renderers can't drift.
  const attach = wireComposerAttach({
    root, attachId: 'mv-attach', pendingId: 'mv-attach-pending', safeImg,
    onNote: (m) => { if (note) note.textContent = m || ''; },
  });

  let busy = false;
  const submit = async () => {
    const text = (input && input.value.trim()) || '';
    const pendingPhoto = attach.get();
    if ((!text && !pendingPhoto) || busy) return;
    busy = true;
    if (note) note.textContent = pendingPhoto ? 'Uploading photo…' : '';
    const res = await postChatMessage({ postMealComment, uploadChatPhoto }, {
      mealId, athleteId: meal.athlete_id || RT.userId, authorId: RT.userId, role: 'athlete',
      text, photo: pendingPhoto,
    });
    if (!res.ok) {
      busy = false;
      if (note) note.textContent = res.error === 'filtered' ? FILTERED_NOTE : res.error === 'upload'
        ? "Couldn't upload that photo. Try again, or remove it and send."
        : "Couldn't send that. Try again when you're back online.";
      return;
    }
    attach.clear();
    if (note) note.textContent = '';
    if (input) input.value = '';
    /* THE COACH HEARS IT. This composer is the third renderer of the same conversation (the live
       meal thread and the nutrition chat are the other two), and it was the only one that posted
       and told nobody — an athlete answering their coach on YESTERDAY's plate wrote into a room
       whose other occupant was never called. Same call, same kind, same deep link as meal.js, and
       a wordless photo says what it is rather than sending an empty body. Fire-and-forget after
       the row landed: a notification failure must never undo a message that already posted. */
    if (S.coach.hasCoach) {
      void notifyMyCoach({
        kind: `athlete_message:${mealId}`, urgent: true,
        title: `${S.athlete.first || 'Your athlete'} ${!text ? 'sent a photo about' : 'asked about'} ${meal.name || meal.type || 'a meal'}`,
        body: `${(text || 'Sent a photo').slice(0, 140)} · Tap to open the conversation.`,
        route: `coach-meal/${mealId}`,
      });
    }
    if (!text) { busy = false; return; } // a photo alone is a complete message — nothing to ask the AI
    /* The same addressing gate the live thread uses. A past plate's thread is still a room with
       a coach in it, and "thanks coach" three days later is no more the AI's to answer than it
       was on the day. */
    const turn = decideAiTurn({
      text,
      comments: rows,
      participants,
      self: { id: RT.userId, name: S.athlete.first || 'Athlete', role: 'athlete' },
      athleteName: S.athlete.first || 'Athlete',
      fallbackNoun: S.coach.noun,
    });
    if (!turn.decision.shouldRespond) { busy = false; return; }
    try {
      await window.sb.functions.invoke('meal-chat', { body: { mealId, question: text, speaker: turn.outgoing, addressing: turn.decision, participants: turn.participants, context: {
        meal: { name: meal.name || meal.type, slot: meal.type, quality: meal.quality,
                macros: { protein: meal.protein, carbs: meal.carbs, fat: meal.fat, cals: meal.kcal }, note: meal.note },
        plan: { goal: RT.primaryGoal || null, allergies: RT.allergies },
        thread: turn.thread,
      } } });
      await refresh();
    } catch { if (note) note.textContent = 'Sent. The reply will appear when the connection is back.'; }
    busy = false;
  };
  if (send) send.addEventListener('click', submit);
  // !isComposing: Enter inside an IME composition is choosing a character, not sending.
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void submit(); } });
}

/* A meals row in the mealDetail() shape, so a past plate renders through the SAME read card and
   breakdown as today's (meal.js mealReadHtml). Nothing is recomputed: the stored row is the read. */
export function pastMealDetail(m) {
  const cap = (x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : 'Meal');
  const nz = (v) => (v == null ? null : v);
  const late = typeof m.minutes_late === 'number' ? Math.max(0, m.minutes_late) : 0;
  const rich = normalizeDetected(m.detected);
  return {
    slot: m.type || 'meal', name: cap(m.type), dish: m.name || '', logged: true, mealId: m.id,
    loggedAt: fmtLoggedAt(m.logged_at) || null, minutesLate: late, late: late > 0,
    score: m.quality != null ? m.quality : null,
    // Two views of the same four numbers. `macros` is coerced for the scoring helpers (reasons,
    // rubric), which do arithmetic; `macrosRaw` keeps null so the tiles can print a dash for a
    // figure this row never had. null and 0 are different facts.
    macros: { protein: m.protein || 0, carbs: m.carbs || 0, fat: m.fat || 0, cals: m.kcal || 0 },
    macrosRaw: { protein: nz(m.protein), carbs: nz(m.carbs), fat: nz(m.fat), cals: nz(m.kcal) },
    fiber: m.fiber || 0, detectedRich: rich, foods: rich.map((d) => d.name),
    // A stored plate with a photo was read from it; without one it was entered by hand. The row
    // does not keep the source, so this is the honest reading of what it does keep.
    source: m.photo_path ? null : 'manual',
    hasPhoto: !!m.photo_path, img: null, live: true, flagged: null,
    note: m.note || '', userNote: '', analysis: m.analysis || '', styleApplied: m.styleApplied || null,
    photoQ: null, pending: false, pendingQuestions: null, analysisFailed: null, rereadError: null,
    corrections: [], orig: null,
  };
}

export const mealView = {
  tab: 'progress',
  // Same as the meal thread: the tab bar and the camera FAB have no business over a logged meal.
  hideTabs: true,
  render({ sub }) {
    const m = histMealById(sub) || (DIRECT.id === sub ? DIRECT.row : null);
    if (!m) {
      return `${backHead('Meal', 'Not available', 'history')}
      <div class="sidebox"><div class="req-icon b s38">${icon('clipboard', 17)}</div>
      <div><div class="tt">Couldn't open this meal</div><div class="ts">Open it from your Activity History.</div></div></div>`;
    }
    // THE SAME DESIGN AS TODAY'S MEAL (founder 2026-09-14): this screen was a simpler twin of the
    // meal thread and the difference showed the moment an athlete opened yesterday's plate. It now
    // stacks the same four blocks: the logged confirmation, the read card (photo, dial, verdict,
    // nutrition, rubric), the detected-foods drawer, and the Team discussion. Sections 2 and 3 are
    // meal.js's own code (mealReadHtml); the confirmation carries that DAY's score instead of the
    // live move, and the discussion mounts through this screen's thread, which already speaks to
    // the same rows and the same AI.
    const M = pastMealDetail(m);
    const when = String(m.day_date);
    const dayRow = (S.history || []).find((h) => h && h.iso === when) || null;
    const dayScore = dayRow && dayRow.score != null ? dayRow.score : null;
    const dayTier = dayScore != null ? tier(dayScore) : null;
    const timing = M.loggedAt ? `Logged ${M.loggedAt} · ${M.minutesLate > 0 ? `${M.minutesLate} min late` : 'on time'}` : 'Logged';
    const execTop = `
    <section class="mt-confirm">
      <div class="row1">
        <div class="ck">${icon('check', 20)}</div>
        <div><div class="t">${esc(M.name)} logged</div>
        <div class="s">${esc(weekdayLong(when))} · ${esc(shortDate(when))} · ${esc(timing)}</div></div>
      </div>
      ${dayScore != null ? `
      <div class="score-line">
        <span class="k">Daily Score</span>
        <span class="to ${dayTier.cls}">${dayScore}</span>
        <span class="tier-chip ${dayTier.cls}">${esc(dayTier.name)}</span>
      </div>` : ''}
    </section>`;
    const { photoBlock, breakdown } = mealReadHtml(M, { exec: null, past: true, dayTotals: pastDayTotalsThrough(m) });
    const discussion = `
    <section class="disc" id="meal-disc" aria-labelledby="disc-title">
    <h2 class="sr-only" id="disc-title">Team discussion</h2>
    <div class="disc-head">
      <div id="mv-members-slot" style="flex:1;min-width:0"><div class="disc-fp"><span class="names"><b>Team discussion</b></span></div></div>
      <button type="button" class="disc-open" id="open-full-chat" aria-label="Open the full conversation at this meal">Open ${icon('chevron', 14)}</button>
    </div>
    <div class="thread" id="mv-thread" role="log" aria-label="Meal conversation">
      <div class="msg-status">Loading…</div>
    </div>
    <div class="chat-dock disc-dock">
    ${composer({ inputId: 'mv-msg', sendId: 'mv-send', placeholder: 'Ask about this meal…', sendLabel: 'Send', attachId: 'mv-attach', atEnd: true })}
    <div class="composer-attach-pending" id="mv-attach-pending" hidden></div>
    <div id="mv-note" style="min-height:18px"></div>
    </div>
    </section>`;
    const foot = `<div class="meal-foot">
      <button class="btn ghost meal-back" data-go="history" aria-label="Back to history">${icon('back', 16)} Back to History</button>
    </div>`;
    return `<div class="meal-screen">${backHead(M.dish || M.name, '', 'history')}${execTop}${photoBlock}${breakdown}${discussion}${foot}</div>`;
  },
  mount(root, { sub }) {
    wireReadControls(root, mealView); // the read's See details / info / confidence controls
    const m = histMealById(sub) || (DIRECT.id === sub ? DIRECT.row : null);
    if (!m) { void fetchMealById(sub); return; }
    void warmHistory(); // so the day bars have that day's other plates to count
    mountThread(root, sub, m);
    // The two doors the read card and the header offer, wired to THIS screen's composer and to
    // the full chat aimed at this plate (nutrition-chat.js reads the sub-route).
    const tell = root.querySelector('#tell-ai');
    if (tell) tell.addEventListener('click', () => focusComposer(root.querySelector('#mv-msg')));
    const open = root.querySelector('#open-full-chat');
    if (open) open.addEventListener('click', () => {
      const dest = `nutrition-chat/${m.id}`;
      if (window.__navigate) window.__navigate(dest); else location.hash = `#${dest}`;
    });
    // The photo, into the hero AND the blurred backdrop, exactly as the meal thread does it.
    const photo = root.querySelector('#meal-photo');
    const hero = root.querySelector('#meal-hero');
    if (!m.photo_path) {
      if (hero && photo) { photo.style.display = 'none'; hero.classList.add('ph-nophoto'); }
      return;
    }
    resolveMealPhoto(m.photo_path).then((url) => {
      if (!url || !root.isConnected || !photo) return;
      photo.onerror = () => { photo.style.display = 'none'; if (hero) hero.classList.add('ph-nophoto'); };
      photo.src = url; photo.style.display = 'block';
      const back = root.querySelector('#meal-backdrop-img');
      if (back) back.src = url;
      if (hero) {
        hero.style.cursor = 'zoom-in';
        hero.setAttribute('tabindex', '0');
        hero.setAttribute('role', 'button');
        hero.setAttribute('aria-label', 'View photo full screen');
        hero.addEventListener('click', () => openImageViewer(url, 'Meal photo', hero));
      }
    });
  },
};
