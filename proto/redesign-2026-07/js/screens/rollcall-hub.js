/* OnStandard: the coach's roll call, one screen (roll call v3, layout A, 2026-09-24; spec section 7).

   Route: rollcall/<commitment id>. The founder picked layout A: ONE screen whose body changes with
   the clock, so the coach never has to know where to go. The header is the roll call and its week
   strip (move or cancel a day, exactly as rollcall-week did; that route redirects here now). The
   body follows rollcall-hub-model.js hubPhase:
     before  "5 of 6 alarms set", each athlete's step (0247 rollcall_arming, never guessed), and ONE
             action: Remind the N not set (the assignment push again, to the phones that have not
             armed; a phone sets its alarm when the athlete opens OnStandard, since the device
             spike failed)
     live    the team board, READ-ONLY here (a coach face is a button whose handlers live on the
             full board, so drawing one here would be a button that does nothing), Nudge the N not
             up, and the link to the full board for one athlete's Nudge or Override
     after   the results for AFTER_HOURS past the close, the board link (override) and history
   Quick actions under it: Move / Cancel the next morning (the week strip's own day sheet), Message
   the group (the announcement screen), Edit the roll call, History.

   Start or Save in the setup lands here and tells the athletes at once (rollcall-v3-data.js
   tellAthletesNow); the line under the header says how that went, for two minutes.

   mount() runs after EVERY render (and the router runs __screenCleanup on every render too), so
   the watchers are NOT torn down by cleanup: each is started once per phase and instance, and
   stops itself the moment the hash is no longer this screen.

   Lazy: registered through the router's lazy registry; nothing on the boot graph imports it.
   Styles: css/screens.css, the rhb- block. */
import { backHead, esc, skeletonRows, emptyState, errorState } from '../components.js';
import { icon } from '../icons.js';
import { CD, bookId } from '../coach-data.js';
import { ensureBook } from './coach-connected.js';
import { initialsOf } from '../initials.js';
import { clockTime } from '../fmt-date.js';
import { fmtMin } from '../requirements.js';
import { VC, loadCommitments, loadLocations, loadUpcoming, loadTeamBoard, subscribeTeamBoard, shiftISO } from '../commitment-data.js';
import { boardModel, boardHtml } from '../team-board.js';
import { weekStrip, weekNote, todayIn, ruleOf, weekSub, firstRollcall, openDaySheet, closeWeekSheet, SHEET_DAYS } from './rollcall-setup.js';
import {
  hubPhase, stepRows, armingCounts, remindLabel, nudgeLabel, morningLabel, alarmsLabel, dayWord, STEP_LABEL,
  movable, isSoon, clockIn, repaintWhenFree,
} from '../rollcall-hub-model.js';
import { loadArming, armingFor, remindArm, nudgeAll, toldState } from '../rollcall-v3-data.js';

const DAYS = SHEET_DAYS;      // the alarm horizon (14): the server materializes and phones arm this far
const TICK_MS = 20000;        // phones arm and report while the coach watches the evening before
const COOLDOWN_MS = 10 * 60000;   // roll-call-coach NUDGE_COOLDOWN_MIN: remind and nudge alike

const HUB = {
  forId: null, failed: false,
  watchKey: '', unsub: null, tick: null,
  armFailed: new Set(),       // instance ids whose arming read failed
  note: null,                 // { key, text, error }: the last action's answer, kept across repaints
  sentAt: new Map(),          // `remind:<instance>` | `nudge:<instance>` -> ms, the server's cooldown
};

const here = (sub) => location.hash === `#rollcall/${sub}`;

/* ---------------------------------------------------------------- the told line */

/* How the tell Start/Save fired went. The count is the REAL one, read off the refreshed arming list
   (athletes whose told stamp is set), so the line can never say "told" beside a row that says
   "Hasn't been told"; until that list lands it holds at "Telling your athletes". A refusal the
   coach cannot act on (404: nothing ahead to tell) says nothing. */
function toldHtml(sub, ph) {
  const t = toldState(sub);
  if (!t || t.state === 'no_instance') return '';
  const nouns = CD.nouns;
  const before = !!(ph && ph.phase === 'before' && ph.instance);
  const arm = before ? armingFor(ph.instance.instance_id) : null;
  let say;
  if (t.state === 'sending' || (t.state === 'ok' && before && !t.refreshed)) {
    say = [`Telling your ${nouns} now…`, ''];
  } else if (t.state === 'ok') {
    const told = arm ? (arm.rows || []).filter((r) => r && r.status !== 'excused' && r.notified_at).length : null;
    const one = nouns.replace(/s$/, '');
    say = !(t.sent > 0) ? ['Saved. Nothing new to tell them.', '']
      : told ? [`Told ${told} ${told === 1 ? one : nouns}.`, 'g']
      : told === 0 ? [`Saved. No phone took the push yet.`, 'a']
      : [`Your ${nouns} were told.`, 'g'];
  } else {
    say = {
      cooldown: [`Saved. Your ${nouns} hear about it within a minute.`, ''],
      flag_off: [`Saved. Pushes are switched off right now, so ${nouns} see it when they open OnStandard.`, 'a'],
      not_authorized: ['Saved. Only the coaching staff can send the push.', 'a'],
      failed: ['Saved. The push didn’t go from this phone. OnStandard sends it within a minute.', 'a'],
    }[t.state] || ['', ''];
  }
  if (!say[0]) return '';
  return `<p class="rhb-told ${say[1]}" role="status" aria-live="polite">${say[1] === 'g' ? icon('check', 16) : icon(t.state === 'sending' || say[1] === '' ? 'clock' : 'bell', 16)}<span>${esc(say[0])}</span></p>`;
}

/* ---------------------------------------------------------------- the three bodies */

function noteHtml(key) {
  // A note lives as long as the cooldown it describes, then goes (the tick repaints it away).
  const n = HUB.note && HUB.note.key === key && Date.now() - HUB.note.at < COOLDOWN_MS ? HUB.note : null;
  return `<p class="rhb-note${n && n.error ? ' is-error' : ''}" id="rhb-note" role="${n && n.error ? 'alert' : 'status'}" aria-live="polite">${n ? esc(n.text) : ''}</p>`;
}

function cooling(key) { const t = HUB.sentAt.get(key); return !!t && Date.now() - t < COOLDOWN_MS; }

function stepRow(r) {
  const name = String(r.name || 'Athlete');
  return `<li class="rhb-row" data-step="${esc(r.step)}">
    <span class="rhb-av" data-avatar-uid="${esc(r.athlete_id || '')}" aria-hidden="true"><span data-avatar-fallback>${esc(initialsOf(name, '?'))}</span></span>
    <span class="rhb-name">${esc(name)}</span>
    <span class="rhb-step">${esc(STEP_LABEL[r.step])}</span>
  </li>`;
}

function beforeHtml(inst, rule) {
  const id = inst.instance_id;
  const when = morningLabel(inst);
  const a = armingFor(id);
  const wordy = dayWord(inst, todayIn(rule.timezone));
  const whenLine = `${wordy ? `${wordy.charAt(0).toUpperCase()}${wordy.slice(1)} · ` : ''}${fmtStart(inst)}`;
  if (!a) {
    if (HUB.armFailed.has(id)) return errorState({ title: 'Who will ring didn’t load', body: 'Reconnect and it loads right here.', retryId: 'rhb-arm-retry' });
    return `<section class="rfig rhb-hero"><div class="rfig-k">${esc(whenLine)}</div></section>${skeletonRows(3, 'Loading who will ring')}`;
  }
  if (a.alarm === false) {
    const arrival = rule.type !== 'morning_roll_call';
    return `<section class="rfig rhb-hero">
      <div class="rfig-k">${esc(whenLine)}</div>
      <div class="rfig-s">${arrival
        ? 'Walking in is the check-in, so there is no alarm to set.'
        : `The alarm is off for this roll call, so phones get a notification at ${esc(fmtStart(inst))} instead. Turn it on in Edit the roll call.`}</div>
    </section>`;
  }
  const c = armingCounts(a.rows);
  const rows = stepRows(a.rows);
  const paused = rule.active === false;   // nobody is asked: no Remind
  const off = rows.filter((r) => r.step === 'no_push');
  const reach = rows.filter((r) => r.step !== 'armed' && r.step !== 'excused' && r.step !== 'no_push');
  const all = c.total > 0 && c.notSet === 0;
  const lead = !c.total ? `Nobody is on this roll call yet.`
    : all ? 'Every alarm is set.'
    : 'A phone sets its alarm when the athlete opens OnStandard.';
  const key = `remind:${id}`;
  const btn = c.reachable && !paused
    ? cooling(key)
      ? `<button type="button" class="btn ghost rhb-act" disabled>${icon('check', 18)} Reminder sent</button>`
      : `<button type="button" class="btn primary rhb-act" id="rhb-remind" data-instance="${esc(id)}">${icon('bell', 18)} ${esc(remindLabel(c.reachable, reach.length === 1 ? reach[0].name : ''))}</button>`
    : '';
  const offLine = off.length
    ? `<p class="rhb-off">${off.length === 1 ? `${esc(first(off[0].name))} has` : `${off.length} have`} notifications off, so a reminder can’t reach them. Tell them in person.</p>`
    : '';
  return `<section class="rfig rhb-hero" aria-label="${esc(`${c.armed} of ${c.total} alarms set for ${when}`)}">
      <div class="rfig-k">${esc(whenLine)}</div>
      <div class="rfig-n">${c.armed}<span class="rfig-u">of ${c.total} alarms set</span></div>
      <div class="rfig-s${all ? ' g' : ''}">${esc(lead)}</div>
    </section>
    ${rows.length ? `<h2 class="eyebrow rhb-h">Who will ring</h2>
    <ul class="card rhb-list${isSoon(inst) ? ' soon' : ''}" aria-label="Who will ring">${rows.map(stepRow).join('')}</ul>` : ''}
    ${btn}${offLine}${noteHtml(key)}`;
}

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'They';
function fmtStart(inst) { return typeof inst.starts_min === 'number' ? fmtMin(inst.starts_min) : clockTime(inst.starts_at); }

function boardBlock(inst, live, rule) {
  const id = inst.instance_id;
  const b = VC.teamBoard(id);
  if (!b) {
    if (VC.teamBoardError(id)) return errorState({ title: 'The board didn’t load', body: 'Reconnect and it loads right here.', retryId: 'rhb-board-retry' });
    return skeletonRows(4, 'Loading the board');
  }
  const m = boardModel(b, null, new Date().toISOString());
  const notUp = m.groups.waiting.filter((r) => r && r.verdict === 'pending').length;
  const when = m.mode === 'arrival' || !b.closes_at ? '' : `${m.closed ? 'Closed' : 'Closes'} ${clockIn(b.closes_at, rule.timezone)}`;
  const key = `nudge:${id}`;
  const act = live && !m.closed && m.mode !== 'arrival' && notUp && rule.active !== false
    ? cooling(key)
      ? `<button type="button" class="btn ghost rhb-act" disabled>${icon('check', 18)} Nudged</button>`
      : `<button type="button" class="btn primary rhb-act" id="rhb-nudge" data-instance="${esc(id)}">${icon('bell', 18)} ${esc(nudgeLabel(notUp))}</button>`
    : '';
  const stale = VC.teamBoardError(id) ? '<p class="rb-stale" role="status">Showing the last update. Reconnecting.</p>' : '';
  const linkT = live ? 'Open the live board' : 'Open the board';
  const linkS = live ? 'Nudge one athlete, or override with a reason' : 'Override a result, with a reason';
  // Named, so this board's count and the NEXT morning's alarm count below never read as one.
  const which = `${live ? 'Live now' : 'Results'} · ${morningLabel(inst)}`;
  return `${stale}<h2 class="eyebrow rhb-h rhb-which">${esc(which)}</h2><div class="rhb-board">${boardHtml(m, { coach: false, when })}</div>
    ${act}${noteHtml(key)}
    <div class="card rows list rhb-links">
      <div class="lrow" data-go="rollcall-board/${esc(id)}" role="button" tabindex="0"><span class="lic" aria-hidden="true">${icon('users', 18)}</span>
        <div class="lm"><div class="lt">${linkT}</div><div class="ls">${linkS}</div></div>${icon('chevron', 16)}</div>
    </div>`;
}

function nextBlock(next) {
  if (!next) return '';
  const alarms = alarmsLabel(next);
  return `<p class="rhb-next">Next roll call: ${esc(morningLabel(next))}${alarms ? ` · ${esc(alarms)}` : ''}</p>`;
}

function bodyHtml(ph, rule) {
  if (ph.phase === 'before') return beforeHtml(ph.instance, rule);
  if (ph.phase === 'live') return `${boardBlock(ph.instance, true, rule)}${nextBlock(ph.next)}`;
  if (ph.phase === 'after') return `${boardBlock(ph.instance, false, rule)}${nextBlock(ph.next)}`;
  return emptyState({ icon: 'sun', title: 'No mornings in the next two weeks', body: 'Put a morning back in the week above, or change the days in Edit the roll call.', compact: true });
}

function actionsHtml(rule, rows) {
  const row = (attrs, ic, t, s, cls = '') => `<div class="lrow${cls}" ${attrs} role="button" tabindex="0"><span class="lic" aria-hidden="true">${icon(ic, 18)}</span>
    <div class="lm"><div class="lt">${esc(t)}</div><div class="ls">${esc(s)}</div></div>${icon('chevron', 16)}</div>`;
  // Only a morning the day sheet can open (it reaches SHEET_DAYS): never a row that does nothing.
  const today = todayIn(rule.timezone);
  const n = movable(rows, Date.now(), shiftISO(today, SHEET_DAYS - 1));
  const word = n ? dayWord(n, today) : '';
  const morning = rule.type === 'morning_roll_call';
  return [
    n ? row(`data-rhb-day="${esc(n.instance_id)}"`, 'clock', `Move ${word}`, morningLabel(n)) : '',
    n ? row(`data-rhb-day="${esc(n.instance_id)}" data-rhb-cancel="1"`, 'x', `Cancel ${word}`, `${morningLabel(n)} · athletes are told at once`) : '',
    row('data-go="coach-announce"', 'message', 'Message the group', `An announcement to your ${CD.nouns}`),
    row(`data-go="rollcall-new/${esc(rule.id)}"`, 'edit', 'Edit the roll call', morning ? 'Time, days, who, alarm and place' : 'Place, time, days and who'),
    row(`data-go="rollcall-history/${esc(rule.id)}"`, 'bars', 'History', 'Who is reliable over the last 30 days'),
  ].join('');
}

/* ---------------------------------------------------------------- watching */

function stopWatching() {
  if (HUB.unsub) { try { HUB.unsub(); } catch { /* gone */ } HUB.unsub = null; }
  if (HUB.tick) { clearInterval(HUB.tick); HUB.tick = null; }
  HUB.watchKey = '';
}

const phaseKey = (ph) => (ph && ph.instance ? `${ph.phase}:${ph.instance.instance_id}` : (ph ? ph.phase : ''));

function watch(sub, ph, rerender) {
  const key = `${sub}|${phaseKey(ph)}`;
  if (HUB.watchKey === key) return;
  stopWatching();
  HUB.watchKey = key;
  const id = ph && ph.instance ? ph.instance.instance_id : null;
  const pullArming = (force) => loadArming(id, force).then((a) => {
    if (!here(sub)) return;
    if (!a) { if (!HUB.armFailed.has(id)) { HUB.armFailed.add(id); rerender(); } return; }
    const was = HUB.armFailed.delete(id);
    if (was || JSON.stringify(a) !== ARM_SEEN.get(id)) { ARM_SEEN.set(id, JSON.stringify(a)); rerender(); }
  });
  if (ph && ph.phase === 'before' && id) {
    ARM_SEEN.set(id, JSON.stringify(armingFor(id)));
    void pullArming(false);
  } else if (ph && (ph.phase === 'live' || ph.phase === 'after') && id) {
    let last = JSON.stringify(VC.teamBoard(id));
    const onBoard = (b) => {
      if (!here(sub)) { stopWatching(); return; }
      const now = JSON.stringify(b);
      if (now !== last) { last = now; rerender(); }
    };
    if (ph.phase === 'live') HUB.unsub = subscribeTeamBoard(id, onBoard);
    else void loadTeamBoard(id).then((b) => { if (b) onBoard(b); else if (here(sub)) rerender(); });
  }
  // One clock for the screen: the body turns with it (before -> live -> after -> the next
  // morning), and the evening before, the arming list refreshes while the coach watches.
  HUB.tick = setInterval(() => {
    if (!here(sub)) { stopWatching(); return; }
    const rows = VC.upcomingFor(sub);
    const now = rows ? hubPhase(rows) : null;
    if (`${sub}|${phaseKey(now)}` !== HUB.watchKey) { rerender(); return; }
    if (HUB.note && Date.now() - HUB.note.at >= COOLDOWN_MS) { HUB.note = null; rerender(); return; }
    if (now && now.phase === 'before' && id) void pullArming(true);
  }, TICK_MS);
}
const ARM_SEEN = new Map();

/* ---------------------------------------------------------------- the screen */

export default {
  nav: 'operator', tab: 'home',
  render({ sub } = {}) {
    const back = CD.kind === 'practice' ? 'trainer' : 'coach-home';
    const rule = ruleOf(sub);
    if (!sub) {
      if (VC.commitments && VC.commitments.length && !firstRollcall()) {
        return `${backHead('Roll call', '', back)}${emptyState({ icon: 'sun', title: 'No roll call yet', body: 'Set one up in four answers: time, days, who and the alarm.', action: { go: 'rollcall-new', label: 'Set one up' } })}`;
      }
      return `${backHead('Roll call', 'Loading…', back)}${skeletonRows(3, 'Loading the roll call')}`;
    }
    if (!rule) {
      if (VC.commitmentsError) return `${backHead('Roll call', '', back)}${errorState({ title: 'This roll call didn’t load', retryId: 'rhb-retry' })}`;
      return `${backHead('Roll call', 'Loading…', back)}${skeletonRows(3, 'Loading the roll call')}`;
    }
    const rows = VC.upcomingFor(sub);
    const today = todayIn(rule.timezone);
    const strip = rows
      ? `${weekStrip(rows, today)}<p class="rw-note">${esc(weekNote(rows, today))}</p>`
      : HUB.forId === sub && HUB.failed
        ? errorState({ title: 'This week didn’t load', body: 'Reconnect and it loads right here. Nothing was changed.', retryId: 'rhb-retry' })
        : skeletonRows(1, 'Loading this week');
    const ph = rows ? hubPhase(rows) : null;
    const paused = rule.active === false
      ? '<p class="rhb-told a" role="status">' + icon('bell', 16) + '<span>This roll call is paused. Nobody is asked to check in.</span></p>' : '';
    return `${backHead(rule.title || 'Roll call', weekSub(rule), back)}
      ${paused}${toldHtml(sub, ph)}
      <div class="rhb-week">${strip}</div>
      <section class="rhb-body rhb-${ph ? ph.phase : 'loading'}" aria-label="${ph && ph.phase === 'live' ? 'Live now' : ph && ph.phase === 'after' ? 'Results' : 'Next roll call'}">${ph ? bodyHtml(ph, rule) : ''}</section>
      <h2 class="eyebrow rhb-h">Quick actions</h2>
      <div class="card rows list rhb-acts">${actionsHtml(rule, rows)}</div>`;
  },

  mount(root, { sub } = {}) {
    ensureBook();
    // Never under an open day sheet: a full repaint closes it mid-Move. Deferred until it closes, once.
    const rerender = () => {
      if (!here(sub) || !window.__render) return;
      repaintWhenFree(document, () => { if (here(sub) && window.__render) window.__render(); }, window.MutationObserver);
    };
    const owner = bookId();
    if (!sub) {
      const go = () => { const r = firstRollcall(); if (r) location.replace(`#rollcall/${r.id}`); else if (window.__render) window.__render(); };
      if (firstRollcall()) { go(); return; }
      if (owner) loadCommitments(owner, CD.kind).then(go, () => {});
      return;
    }
    const hadRule = !!ruleOf(sub);
    if (owner) Promise.all([loadCommitments(owner, CD.kind), loadLocations(owner, CD.kind)]).then(() => { if (!hadRule && ruleOf(sub)) rerender(); }, () => {});

    // The week (14 days: the alarm horizon), fresh on arrival, then from the cache on repaints.
    if (HUB.forId !== sub) { HUB.forId = sub; HUB.failed = false; HUB.note = null; }
    const before = JSON.stringify(VC.upcomingFor(sub));
    void loadUpcoming(sub, DAYS).then((got) => {
      if (got === null) { const was = HUB.failed; HUB.failed = true; if (!was) rerender(); return; }
      const wasFailed = HUB.failed;
      HUB.failed = false;
      if (wasFailed || JSON.stringify(got) !== before) rerender();
    });

    // The tell Start/Save fired: once it answers, read who was told, THEN say the count.
    const t = toldState(sub);
    if (t && !t.watched) {
      t.watched = true;
      const settle = () => { t.refreshed = true; rerender(); };
      t.done.then(() => {
        const ph = hubPhase(VC.upcomingFor(sub) || []);
        return ph.phase === 'before' && ph.instance ? loadArming(ph.instance.instance_id, true) : null;
      }).then(settle, settle);
    }

    const rows = VC.upcomingFor(sub);
    if (rows) watch(sub, hubPhase(rows), rerender);

    const prev = window.__screenCleanup;
    window.__screenCleanup = () => { closeWeekSheet(null); if (typeof prev === 'function') prev(); };

    const on = (sel, fn) => { const el = root.querySelector(sel); if (el) el.addEventListener('click', () => fn(el)); };
    on('#rhb-retry', async (b) => {
      b.disabled = true;
      if (owner) await loadCommitments(owner, CD.kind, true);
      const got = await loadUpcoming(sub, DAYS, true);
      HUB.failed = got === null;
      rerender();
    });
    on('#rhb-arm-retry', async (b) => {
      b.disabled = true;
      const ph = hubPhase(VC.upcomingFor(sub) || []);
      if (ph.instance) { const a = await loadArming(ph.instance.instance_id, true); if (a) HUB.armFailed.delete(ph.instance.instance_id); }
      rerender();
    });
    on('#rhb-board-retry', async (b) => {
      b.disabled = true;
      const ph = hubPhase(VC.upcomingFor(sub) || []);
      if (ph.instance) await loadTeamBoard(ph.instance.instance_id, true);
      rerender();
    });

    const say = (key, text, error = false) => {
      HUB.note = { key, text, error, at: Date.now() };
      const el = root.querySelector('#rhb-note');
      if (el) { el.textContent = text; el.classList.toggle('is-error', error); el.setAttribute('role', error ? 'alert' : 'status'); }
    };
    on('#rhb-remind', async (b) => {
      if (b.disabled) return;
      const id = b.getAttribute('data-instance');
      const key = `remind:${id}`;
      b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Sending…';
      const r = await remindArm(id);
      const SAY = {
        ok: ['Sent. Each phone sets its alarm when the athlete opens OnStandard.', false],
        nobody: ['Every alarm is set now. Nothing to send.', false],
        rate_limited: ['A reminder went out in the last 10 minutes. Try again after that.', false],
        no_instance: ['This morning has already started, or the roll call is paused. Nothing was sent.', false],
        flag_off: ['Reminders are switched off right now.', true],
        not_authorized: ['Only the coaching staff can send reminders.', true],
        failed: ['Couldn’t send. Check your connection and try again.', true],
      }[r.reason] || ['Couldn’t send. Check your connection and try again.', true];
      if (r.reason === 'ok' || r.reason === 'rate_limited') HUB.sentAt.set(key, Date.now());
      HUB.note = { key, text: SAY[0], error: SAY[1], at: Date.now() };
      await loadArming(id, true);
      rerender();
    });
    on('#rhb-nudge', async (b) => {
      if (b.disabled) return;
      const id = b.getAttribute('data-instance');
      const key = `nudge:${id}`;
      b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Sending…';
      const r = await nudgeAll(id);
      const [text, error] = {
        ok: [r.sent ? `Nudged ${r.sent}. Each gets their own I’m Up.` : 'Everyone is up now.', false],
        rate_limited: ['They were nudged in the last 10 minutes. Try again after that.', false],
        flag_off: ['Nudges are switched off right now.', true],
        not_authorized: ['Only the coaching staff can nudge.', true],
        no_instance: ['This roll call has closed. Nothing was sent.', false],
      }[r.reason] || ['Couldn’t send. Check your connection and try again.', true];
      if (r.reason === 'ok' || r.reason === 'rate_limited') HUB.sentAt.set(key, Date.now());
      say(key, text, error);
      await loadTeamBoard(id, true);
      rerender();
    });

    const openDay = (b) => {
      openDaySheet(root, sub, b.getAttribute('data-rw-day') || b.getAttribute('data-rhb-day'), b, rerender);
      // "Cancel …" opens the same sheet with its cancel button ready under the thumb.
      if (b.hasAttribute('data-rhb-cancel')) {
        const c = document.querySelector('.sheet.rw-sheet #rw-cancel');
        if (c) { try { c.focus({ preventScroll: true }); c.scrollIntoView({ block: 'nearest' }); } catch { /* no focus */ } }
      }
    };
    root.querySelectorAll('[data-rw-day], [data-rhb-day]').forEach((b) => {
      b.addEventListener('click', () => openDay(b));
      if (b.hasAttribute('data-rhb-day')) b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(b); } });
    });
  },
};
