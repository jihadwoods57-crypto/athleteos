import { S, RT } from '../state.js';
import { DAY, MEAL_KEYS } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg, emptyState, skeletonRows, segBar } from '../components.js';
import { tierColor } from '../score-band.js';
import { cachedMealPhoto, warmMealPhotos, resolveMealPhoto } from '../photo-store.js';
import { fetchRecentMeals, daysAgoISO, fetchMealComments, postMealComment, deleteMealComment, uploadChatPhoto, fetchThreadParticipants, signedMealPhotoUrl } from '../roles.js';
import { attachedPhoto, isPhotoOnly, bubblePhotoHtml, hydrateThreadPhotos, wireComposerAttach, postChatMessage } from '../chat-attach.js';
import { threadMessages, reactionGroups, REACTION_EMOJI } from '../meal-intel.js';
import { wireTapback } from '../tapback.js';
import { layoutThread, authorName, initialsFor, isAnalysisUpdate, isEscalated, quotedFor } from '../chat-view.js';

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
      <section class="card pad" style="border-color:var(--purple-border)">
        <div style="display:flex;align-items:center;gap:14px">
          <div class="req-icon p" style="width:52px;height:52px;border-radius:16px">${icon('shield', 26)}</div>
          <div style="flex:1">
            <div style="font-size:17px;font-weight:800">${t.left} left</div>
            <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:3px">Spend one on any meal from the hub. Expires ${esc(t.expires)}.</div>
          </div>
        </div>
      </section>

      <div class="eyebrow">How it scores</div>
      <section class="card" style="padding:6px 16px">
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--purple-surface);color:var(--purple-bright)">${icon('bars', 17)}</div>
          <div class="lm"><div class="lt">Your trailing-10 median</div><div class="ls">Credit comes from your last 10 real photo-earned days for that slot. One hero plate can't inflate it, and a covered day never counts toward the median itself.</div></div>
        </div>
      </section>

      <div class="eyebrow">Change your mind</div>
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
    <section class="card pad" style="border-color:var(--purple-border)">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="req-icon p" style="width:52px;height:52px;border-radius:16px">${icon('shield', 26)}</div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:800">Every meal is covered</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:3px">Nothing to tap. Your score keeps moving from your real logging history through ${esc(t.covers_until)}.</div>
        </div>
      </div>
    </section>

    <div class="eyebrow">How it scores</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--purple-surface);color:var(--purple-bright)">${icon('bars', 17)}</div>
        <div class="lm"><div class="lt">Your trailing-10 median</div><div class="ls">Each meal credits your last 10 real photo-earned days for that slot. One hero plate can't inflate it, and a covered day never counts toward the median itself.</div></div>
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
      ${S.score >= 80
        ? `<div style="font-size:12.5px;font-weight:600;color:var(--green-bright);margin-top:10px">Today is above the bar.${S.streakDays > 0 ? ` Day ${S.streakDays} locks at midnight.` : ' Your streak starts when today locks at midnight.'}</div>`
        : `<div style="font-size:12.5px;font-weight:600;color:var(--amber-bright);margin-top:10px">Today is still live. Reach 80 before the day closes to continue your streak.</div>`}
      <div style="font-size:12px;font-weight:700;color:var(--text-2);margin-top:8px">Weekly grace available: ${graceAvailable}${graceAvailable ? '' : ` · used ${S.streak.label.replace('grace used ', '')}`}</div>
    </section>

    <div class="eyebrow">This week</div>
    <section class="card pad">
      <div class="stk-week">
        ${cal.map(x => `
          <div class="stk-day ${x.on ? 'on' : x.future ? 'future' : x.today ? '' : 'miss'}${x.today ? ' today' : ''}">
            <span class="d">${x.label}</span>
            <span class="s">${x.score != null ? x.score : x.future ? '·' : '—'}</span>
            ${x.grace ? '<span class="g">Grace</span>' : ''}
          </div>`).join('')}
      </div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:14px">Your real day scores, Monday through Sunday. A day under 80 ends the run unless your weekly grace bridges it — grace applies only after the day closes.</div>
    </section>

    <div class="eyebrow">The rules</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('target', 17)}</div>
        <div class="lm"><div class="lt">80 is the bar</div><div class="ls">On standard means 80+. Not close, not almost.</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('shield', 17)}</div>
        <div class="lm"><div class="lt">One grace per rolling 7 days</div><div class="ls">A single miss is bridged after the day closes — the chain survives, the day never counts. A second miss inside the week ends the run.</div></div>
      </div>
      <div class="lrow" style="cursor:default">
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

let HIST = { rows: null, at: 0, uid: null }; // fetched meals cache (session; 60s freshness)
export function histMealById(id) {
  return (HIST.rows || []).find((m) => String(m.id) === String(id)) || null;
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
    ${m.quality != null ? `<div class="hist-score ${m.quality >= 80 ? 'g' : m.quality >= 50 ? 'a' : 'r'}">${m.quality}<small>/100</small></div>` : ''}
    ${icon('chevron', 15, 'style="color:var(--text-3);flex:none"')}
  </div>`;
}

export const history = {
  tab: 'progress',
  render() {
    const dayHead = (label, score, tierName) => `
      <div class="eyebrow" style="display:flex;justify-content:space-between;align-items:baseline">
        <span>${label}</span>
        ${score != null ? `<span style="text-transform:none;letter-spacing:0;font-size:13px;font-weight:800;color:${tierColor(score)}">${score}${tierName ? ` · ${tierName}` : ''}</span>` : ''}
      </div>`;
    const todayLabel = `Today · ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()]}`;
    const rows = HIST.rows;
    let body;
    if (rows === null) {
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
      const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      body = groups.map((g) => {
        const isToday = g.date === todayISO;
        const d = new Date(g.date + 'T00:00:00');
        const label = isToday ? todayLabel : `${DOW[d.getDay()]} · ${MON[d.getMonth()]} ${d.getDate()}`;
        const h = scoreBy[g.date];
        const score = isToday ? S.score : (h ? h.score : null);
        const tierName = isToday ? S.tier.name : (h ? h.tier : null);
        return dayHead(label, score, tierName) + `<section class="card" style="padding:4px 12px">${g.meals.map((m) => histCard(m, isToday)).join('')}</section>`;
      }).join('');
    }
    return `
    ${backHead('Activity History', 'The proof trail, day by day', 'progress')}
    ${body}
    <div style="height:10px"></div>
    `;
  },
  mount() {
    // Fetch real meal rows (14 days) once per minute per user; repaint when they land, then
    // warm photo signed-URLs (second repaint when those resolve). Both best-effort.
    if (!RT.userId) return;
    const fresh = HIST.uid === RT.userId && Date.now() - HIST.at < 60000;
    if (fresh) {
      warmMealPhotos((HIST.rows || []).map((m) => m.photo_path).filter(Boolean));
      return;
    }
    fetchRecentMeals(RT.userId, daysAgoISO(14)).then((rows) => {
      HIST = { rows: rows || [], at: Date.now(), uid: RT.userId };
      warmMealPhotos((rows || []).map((m) => m.photo_path).filter(Boolean));
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
    const items = layoutThread(msgs, { fmtTime: mvClock, fmtDay: mvDay });
    // Reactions are keyed to the MEAL, not a message (0049) — same rule as the live thread:
    // they sit once, on the last bubble, where the eye lands.
    const msgItems = items.filter((i) => i.type !== 'time');
    const lastMsg = msgItems.length ? msgItems[msgItems.length - 1].comment : null;
    threadEl.innerHTML = items.map((item) => {
      if (item.type === 'time') return `<div class="tsep">${esc(item.label)}</div>`;
      const c = item.comment;
      const mine = c.role === 'athlete' && (!c.author_id || c.author_id === RT.userId);
      const who = authorName(c, participants, RT.userId, S.coach.noun);
      const update = isAnalysisUpdate(c);
      const escalated = isEscalated(c);
      const quoted = update ? quotedFor(c, msgs) : null;
      const photo = attachedPhoto(c);
      const photoOnly = isPhotoOnly(c);
      const rx = c === lastMsg ? reactionGroups(rows) : [];
      return `
        <div class="msg ${mine ? 'athlete' : c.role === 'ai' ? 'ai' : 'coach'}${item.firstOfRun ? '' : ' cont'}${rx.length ? ' has-rx' : ''}">
          ${!mine && item.firstOfRun ? `<div class="av">${c.role === 'ai' ? icon('sparkle', 15) : esc(initialsFor(who))}</div>` : '<div class="av-sp"></div>'}
          <div class="stack">
            ${item.firstOfRun && !mine ? `<div class="who">${esc(who)}</div>` : ''}
            ${quoted ? `<div class="quote"><span class="stem"></span><span class="qtext">${esc(quoted.text)}</span></div>` : ''}
            <div class="bubble">${update ? '<span class="upd">Updated analysis</span>' : escalated ? '<span class="esc">Sent to your coach</span>' : ''}${bubblePhotoHtml(photo, esc)}${photoOnly ? '' : esc(String(c.text || ''))}</div>
            ${rx.length ? `<span class="rxo">${rx.map((r) => `${esc(r.emoji)} ${r.count}`).join(' ')}</span>` : ''}
          </div>
        </div>`;
    }).join('');
    // Resolve any attachments just painted. trust.js imports named roles functions rather than the
    // module, so the helper is handed the one function it needs.
    void hydrateThreadPhotos(threadEl, { signedMealPhotoUrl });
  };

  // Tap an attached photo to open it full-screen. Delegated: every repaint replaces the <img>.
  threadEl.addEventListener('click', (ev) => {
    const im = ev.target && ev.target.closest ? ev.target.closest('img.bimg') : null;
    if (!im || !im.src) return;
    openImageViewer(im.src, 'Photo attached to this message');
  });

  const refresh = async () => {
    const [fetched, people] = await Promise.all([
      fetchMealComments(mealId).catch(() => []),
      participants.length ? Promise.resolve(participants) : fetchThreadParticipants(RT.userId).catch(() => []),
    ]);
    rows = Array.isArray(fetched) ? fetched : [];
    participants = Array.isArray(people) ? people : [];
    if (root.isConnected) paint();
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
      if (ok) await refresh(); else if (note) note.textContent = "Couldn't save that reaction — try again.";
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
      if (note) note.textContent = res.error === 'upload'
        ? "Couldn't upload that photo — try again, or remove it and send."
        : "Couldn't send that. Try again when you're back online.";
      return;
    }
    attach.clear();
    if (note) note.textContent = '';
    if (input) input.value = '';
    await refresh();
    if (!text) { busy = false; return; } // a photo alone is a complete message — nothing to ask the AI
    try {
      await window.sb.functions.invoke('meal-chat', { body: { mealId, question: text, context: {
        meal: { name: meal.name || meal.type, slot: meal.type, quality: meal.quality,
                macros: { protein: meal.protein, carbs: meal.carbs, fat: meal.fat, cals: meal.kcal }, note: meal.note },
        plan: { goal: RT.primaryGoal || null, allergies: RT.allergies },
        thread: threadMessages(rows).slice(-20).map((c) => ({ role: c.role, text: String(c.text).slice(0, 300) })),
      } } });
      await refresh();
    } catch { if (note) note.textContent = 'Sent. The reply will appear when the connection is back.'; }
    busy = false;
  };
  if (send) send.addEventListener('click', submit);
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } });
}

export const mealView = {
  tab: 'progress',
  render({ sub }) {
    const m = histMealById(sub) || (DIRECT.id === sub ? DIRECT.row : null);
    if (!m) {
      return `${backHead('Meal', 'Not available', 'history')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Couldn't open this meal</div><div class="ts">Open it from your Activity History.</div></div></div>`;
    }
    const late = typeof m.minutes_late === 'number' && m.minutes_late > 0;
    const name = m.name || (m.type ? m.type.charAt(0).toUpperCase() + m.type.slice(1) : 'Meal');
    const img = m.photo_path ? cachedMealPhoto(m.photo_path) : null;
    const d = new Date(String(m.day_date) + 'T00:00:00');
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const when = isNaN(d) ? '' : `${MON[d.getMonth()]} ${d.getDate()}`;
    return `
    ${backHead(name, `${when}${fmtLoggedAt(m.logged_at) ? ` · ${fmtLoggedAt(m.logged_at)}` : ''} · ${late ? `${m.minutes_late} min late` : 'On time'}`, 'history')}
    <div class="photo-hero" id="mv-hero" style="${img && safeImg(img) ? `background-image:url('${safeImg(img)}')` : 'background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))'}">
      <div class="ph-grad"></div>
      <div class="ph-meta">
        <div>${m.photo_path ? '' : `<span class="status-pill muted">No photo submitted</span>`}</div>
        ${m.quality != null ? `<div class="scorechip ${m.quality >= 80 ? '' : m.quality >= 50 ? 'mid' : 'low'}"><span class="v">${m.quality}</span><span class="k">Meal</span></div>` : ''}
      </div>
    </div>
    ${Array.isArray(m.detected) && m.detected.length ? `
    <div class="eyebrow">Detected</div>
    <div class="foodchips">${m.detected.slice(0, 8).map((f) => `<span class="foodchip"><span class="dot"></span>${esc(String(f))}</span>`).join('')}</div>` : ''}
    <div class="eyebrow">Nutrition</div>
    <div class="macro-row">
      <div class="macro"><div class="mv">${m.protein || 0}g</div><div class="mk">Protein</div></div>
      <div class="macro"><div class="mv">${m.carbs || 0}g</div><div class="mk">Carbs</div></div>
      <div class="macro"><div class="mv">${m.fat || 0}g</div><div class="mk">Fat</div></div>
      <div class="macro"><div class="mv">${m.kcal || 0}</div><div class="mk">Calories</div></div>
    </div>
    ${m.analysis || m.note ? `
    <div style="height:12px"></div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">AI Analysis</div><p>${esc(m.analysis || m.note)}</p></div>
    </div>` : ''}
    <div class="eyebrow" style="margin-top:16px">Conversation</div>
    <div class="thread" id="mv-thread">
      <div class="msg-status">Loading…</div>
    </div>
    ${composer({ inputId: 'mv-msg', sendId: 'mv-send', placeholder: 'Reply about this meal…', sendLabel: 'Send', attachId: 'mv-attach' })}
    <div class="composer-attach-pending" id="mv-attach-pending" hidden></div>
    <div id="mv-note" style="min-height:18px"></div>
    <div style="height:10px"></div>`;
  },
  mount(root, { sub }) {
    const m = histMealById(sub) || (DIRECT.id === sub ? DIRECT.row : null);
    if (!m) { void fetchMealById(sub); return; }
    mountThread(root, sub, m);
    if (!m.photo_path) return;
    resolveMealPhoto(m.photo_path).then((url) => {
      if (!url || !root.isConnected) return;
      const hero = root.querySelector('#mv-hero');
      if (hero) {
        hero.style.backgroundImage = `url('${url.replace(/'/g, '')}')`;
        hero.style.cursor = 'zoom-in';
        hero.addEventListener('click', () => openImageViewer(url, 'Meal photo'));
      }
    });
  },
};
