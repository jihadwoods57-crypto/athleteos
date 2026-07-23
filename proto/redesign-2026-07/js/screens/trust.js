import { S, RT } from '../state.js';
import { DAY, MEAL_KEYS } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg } from '../components.js';
import { cachedMealPhoto, warmMealPhotos, resolveMealPhoto } from '../photo-store.js';
import { fetchRecentMeals, daysAgoISO } from '../roles.js';
import { openImageViewer } from '../image-viewer.js';

/* ---------- Trust Pass detail: the earned camera-free reward, rules visible ---------- */
export const trust = {
  tab: 'home',
  render() {
    const t = S.trustPass;
    if (!t.active) {
      return `${backHead('Trust Pass', 'Not earned yet')}
      <div class="state-demo">
        <div class="sd-ic">${icon('shield', 24)}</div>
        <div class="sd-t">Earn it with 7 on-standard days</div>
        <div class="sd-s">Show the pattern with photos first. Then your coach can grant camera-free days credited from your real history.</div>
      </div>`;
    }
    // decay curve: full credit through day 10, then -5%/day
    const pts = Array.from({ length: 14 }, (_, i) => {
      const d = i + 1;
      const pct = d <= 10 ? 1 : Math.max(0, 1 - (d - 10) * 0.05);
      return [16 + (i / 13) * 268, 74 - pct * 54];
    });
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const youX = 16 + ((t.day - 1) / 13) * 268;
    // Where the athlete's credit actually sits on the decay slope (same formula as pts).
    const youY = 74 - (t.day <= 10 ? 1 : Math.max(0, 1 - (t.day - 10) * 0.05)) * 54;
    // Next camera spot-check derived from the real current day — never a frozen "day 5".
    const nextCheck = t.day < 5 ? 5 : t.day < 10 ? 10 : null;
    return `
    ${backHead('Trust Pass', `Day ${t.day} of ${t.length} · camera-free, honestly`)}

    <section class="card pad" style="border-color:var(--purple-border)">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="req-icon p" style="width:52px;height:52px;border-radius:16px">${icon('shield', 26)}</div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:800">Active · earned, not given</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:3px">Granted by ${esc(S.coach.nameMid)} after 7 on-standard days with photo proof.</div>
        </div>
      </div>
      <div class="pass-days">
        ${Array.from({ length: t.length }, (_, i) => {
          const d = i + 1;
          const isCheck = d === 5 || d === 10;
          const cls = d <= t.day ? 'done' : isCheck ? 'check' : '';
          return `<div class="pd ${cls}">${d}</div>`;
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10.5px;font-weight:700;color:var(--text-3)">
        <span>DAY ${t.day} · CREDITED</span><span style="color:var(--amber-bright)">DAYS 5 & 10 · CAMERA CHECK</span>
      </div>
    </section>

    <div class="eyebrow">How today gets credited</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--purple-surface);color:var(--purple-bright)">${icon('bars', 17)}</div>
        <div class="lm"><div class="lt">Your trailing-10 median</div><div class="ls">Credit comes from your last 10 real photo-earned days. One hero plate can't inflate it.</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('check', 17)}</div>
        <div class="lm"><div class="lt">Your answer scales it</div><div class="ls">Yes = full credit · Partial = 60% · No = zero. Honesty is the input.</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--amber-surface);color:var(--amber-bright)">${icon('camera', 17)}</div>
        <div class="lm"><div class="lt">Spot-check every 5th day</div><div class="ls">${nextCheck ? `Day 5 and day 10 the camera comes back. Next check: day ${nextCheck}.` : 'Day 5 and day 10 the camera came back — both checks cleared. Coast on your real logging.'}</div></div>
      </div>
    </section>

    <div class="eyebrow">Credit decays if it goes stale</div>
    <section class="card pad">
      <svg width="100%" viewBox="0 0 300 84">
        <path d="${path}" fill="none" stroke="url(#tg)" stroke-width="2.5" stroke-linecap="round"/>
        <defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#A855F7"/><stop offset="70%" stop-color="#A855F7"/><stop offset="100%" stop-color="#F5A524"/>
        </linearGradient></defs>
        <line x1="${youX}" y1="14" x2="${youX}" y2="76" stroke="rgba(168,85,247,0.4)" stroke-width="1.5" stroke-dasharray="3 3"/>
        <circle cx="${youX}" cy="${youY.toFixed(1)}" r="4" fill="#C084FC" stroke="#0B0F1A" stroke-width="1.5"/>
        <text x="${youX}" y="10" fill="#C084FC" font-size="9" font-weight="800" text-anchor="middle" font-family="Plus Jakarta Sans">YOU · DAY ${t.day}</text>
        <text x="16" y="82" fill="#64748B" font-size="8.5" font-weight="700" font-family="Plus Jakarta Sans">DAY 1</text>
        <text x="220" y="82" fill="#64748B" font-size="8.5" font-weight="700" font-family="Plus Jakarta Sans">DAY 10</text>
        <text x="284" y="82" fill="#64748B" font-size="8.5" font-weight="700" text-anchor="end" font-family="Plus Jakarta Sans">14</text>
      </svg>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:8px">Full credit through day 10, then it bleeds about 4 points a day. Fresh photos reset the baseline.</div>
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
    ${backHead('Streak', `${S.streakDays} days on standard`, 'progress')}

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
        ${score != null ? `<span style="text-transform:none;letter-spacing:0;font-size:13px;font-weight:800;color:${score >= 90 ? 'var(--green-bright)' : score >= 75 ? 'var(--blue-bright)' : 'var(--amber-bright)'}">${score}${tierName ? ` · ${tierName}` : ''}</span>` : ''}
      </div>`;
    const todayLabel = `Today · ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()]}`;
    const rows = HIST.rows;
    let body;
    if (rows === null) {
      body = `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:8px 2px">Loading your history…</div>`;
    } else if (!rows.length) {
      body = `<div class="sidebox" style="margin-top:12px"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Your proof trail builds here</div><div class="ts">Every meal you log — photo, time, and score — becomes part of your record.</div></div></div>`;
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
export const mealView = {
  tab: 'progress',
  render({ sub }) {
    const m = histMealById(sub);
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
    <div style="height:10px"></div>`;
  },
  mount(root, { sub }) {
    const m = histMealById(sub);
    if (!m || !m.photo_path) return;
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
