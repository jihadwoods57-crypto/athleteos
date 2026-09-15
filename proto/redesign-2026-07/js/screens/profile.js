import { S, RT } from '../state.js';
import { avatarControlHtml, wireAvatarUpload } from '../avatar-upload.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg } from '../components.js';
import { dir, debounce } from '../ob-directory.js';

/* An external row: same .lrow shape as everything else in the group, but an <a> so the WebView
   hands the link to the system (mail app, Safari). Mirrors settings.js terms' ext(). */
function ext(href, ic, t, sub) {
  return `
      <a class="lrow" href="${href}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <div class="lic">${icon(ic, 16)}</div>
        <div class="lm"><div class="lt">${t}</div><div class="ls">${sub}</div></div>
        ${icon('external', 15, 'class="chev-dim"')}
      </a>`;
}

export default {
  tab: 'profile',
  render() {
    const t = S.pass;
    const a = S.athlete;
    const e = S.exec || {};
    // THE HERO (founder 2026-09-15: "improve the player profile design but not complicate it.
    // Include their profile picture"). The person leads: a large photo with the camera badge
    // on it, the name, the one line that places them, and three facts they earned. Everything
    // below is the same rows, in six groups instead of eleven, with the doors that went to the
    // same place folded into one.
    const place = S.audience === 'client'
      ? [S.planGoalLabel || 'Personal plan', S.coach.kind === 'trainer' ? S.coach.team : ''].filter(Boolean).join(' · ')
      : [a.sport, a.position, a.school].filter(Boolean).join(' · ');
    const placeLine = place
      ? `<div class="pf-meta">${esc(place)}</div>`
      : `<div class="pf-meta meta-add" data-go="edit-profile" role="button" tabindex="0">Add your sport and school</div>`;
    const hero = `
    <section class="pf-hero">
      ${avatarControlHtml({ uid: RT.userId, initials: a.initials, size: 88, editable: true })}
      <div class="pf-id">
        <div class="pf-name">${esc(a.name)}</div>
        ${placeLine}
      </div>
      <div class="pf-stats">
        <button type="button" class="pf-stat" data-go="streak"><b>${S.streakDays}</b><small>day streak</small></button>
        <button type="button" class="pf-stat" data-go="score-breakdown"><b>${e.score != null ? e.score : '–'}</b><small>today</small></button>
        <button type="button" class="pf-stat" data-go="score-explained"><b class="${esc(S.tier.cls || '')}">${esc(S.tier.name || '–')}</b><small>standing</small></button>
      </div>
      <button class="btn ghost sm pf-edit" data-go="edit-profile">Edit profile</button>
    </section>`;

    const coachNoun = S.coach.kind === 'trainer' ? 'Trainer' : 'Coach';
    const coach = S.coach.hasCoach ? `
    <h2 class="eyebrow">${coachNoun} Connection</h2>
    <section class="card rows">
      ${/* The person you answer to, with their real face (hydrated by uid like every thread
            avatar), and the row IS the door to what they can see. It used to be a dead row with
            a separate "View connection" beneath it: two rows, one fact. */''}
      <div class="lrow" data-go="privacy">
        <div class="lic pf-coach-av"${S.coach.id ? ` data-avatar-uid="${esc(S.coach.id)}"` : ''}><span data-avatar-fallback>${esc(S.coach.initials)}</span></div>
        <div class="lm"><div class="lt">${esc(S.coach.name)}</div><div class="ls">${esc([S.coach.role, S.coach.team].filter(Boolean).join(' · '))} · what they can see</div></div>
        ${icon('chevron', 17, 'class="chev-dim"')}
      </div>
      <div class="lrow" data-go="messages">
        <div class="lic">${icon('message', 17)}</div>
        <div class="lm"><div class="lt">Messages</div><div class="ls">${esc(S.coach.name)}'s comments land on your meals</div></div>
        ${icon('chevron', 17, 'class="chev-dim"')}
      </div>
    </section>` : `
    <h2 class="eyebrow">${coachNoun} Connection</h2>
    <section class="card pad pf-connect">
      <div class="pf-connect-t">Connect your coach or trainer</div>
      <div class="pf-connect-s">Share your execution, receive requirements, and communicate directly.</div>
      <button class="btn primary sm pf-connect-b" data-go="connect">${icon('key', 16)} Connect</button>
    </section>`;

    const trust = t.active ? `
    <div class="trust pf-trust" data-go="trust" role="button" tabindex="0">
      <div class="ic">${icon('shield', 20)}</div>
      <div class="pf-trust-t">
        <div class="tt">${t.kind === 'credits' ? `Trust Pass active · ${t.left} left` : `Trust Pass active · day ${t.day} of ${t.length}`}</div>
        <div class="ts">Earned with ${(RT.passPolicy || { eligibility_days: 7 }).eligibility_days} photo-logged days. Tap for the rules.</div>
      </div>
      ${icon('chevron', 18, 'class="chev-dim"')}
    </div>` : '';

    const row = (go, ic, title, sub, extra = '') => `
      <div class="lrow" data-go="${go}">
        <div class="lic${extra}">${icon(ic, 17)}</div>
        <div class="lm"><div class="lt">${title}</div><div class="ls">${sub}</div></div>
        ${icon('chevron', 17, 'class="chev-dim"')}
      </div>`;

    return `
    <h1 class="sr-only">Profile</h1>
    ${hero}
    ${trust}
    ${coach}

    <h2 class="eyebrow">Account</h2>
    <section class="card rows">
      ${row('edit-profile', 'user', 'Personal details', 'Name, sport, position, school')}
      <div class="lrow" data-go="account">
        <div class="lic">${icon('lock', 17)}</div>
        <div class="lm"><div class="lt">Sign-in &amp; email</div><div class="ls">${esc(RT.email || 'Password, email address')}</div></div>
        ${icon('chevron', 17, 'class="chev-dim"')}
      </div>
      ${row('settings', 'gear', 'Preferences', 'Units, appearance, Face ID, app tour')}
      ${row('billing', 'bolt', 'Plan &amp; billing', 'Your membership &amp; premium features', ' pf-lic-green')}
      ${row('invite-parent', 'users', 'Invite a parent', 'Let a parent see your score &amp; streak')}
    </section>

    <h2 class="eyebrow">Tracking</h2>
    <section class="card rows">
      ${row('plan-style', 'target', 'Plan style', `${esc(S.planStyle.name)} · ${S.planStyle.canChoose ? 'yours to change' : esc(S.planStyle.sourceLabel)}`)}
      ${row('apple-health', 'heart', 'Apple Health', 'Steps, workouts and sleep, from your phone')}
      ${row('notif-settings', 'bell', 'Reminders', 'Tone, quiet hours')}
      ${row('restrictions', 'bell', 'Food restrictions &amp; allergies', RT.allergies.length ? esc(RT.allergies.join(' · ')) : 'None declared', ' pf-lic-red')}
    </section>

    <h2 class="eyebrow">Your record</h2>
    <section class="card rows">
      ${row('history', 'clipboard', 'Activity history', 'The proof trail, day by day')}
      ${row('connected-standards', 'bolt', 'Activity standards', 'Steps, distance and workouts · verified from your device', ' pf-lic-blue')}
      ${S.audience === 'client' && S.coach.kind === 'trainer' ? '' : `
      ${row('recruiting', 'shield', 'Discipline record', S.coach.hasCoach ? 'Coach-verified · proof of the work' : 'Not verified yet · connect a coach to verify', S.coach.hasCoach ? ' pf-lic-green' : '')}
      <div class="lrow" data-go="verified-profile">
        <div class="lic pf-lic-blue">${icon('share', 17)}</div>
        <div class="lm"><div class="lt">Verified Profile</div><div class="ls">A public page recruiters can check</div></div>
        ${icon('chevron', 17, 'class="chev-dim"')}
      </div>`}
      ${row('score-explained', 'info', 'Score colors explained', 'What every tier and meal band means', ' pf-lic-blue')}
    </section>

    <h2 class="eyebrow">Support &amp; legal</h2>
    <section class="card rows">
      ${row('feedback', 'message', 'Request a feature', 'Or report a bug, or ask us anything')}
      ${ext('mailto:support@onstandard.app', 'mail', 'Support email', 'support@onstandard.app')}
      ${row('privacy', 'eye', 'Privacy &amp; your data', 'Who sees what · download your data')}
      ${ext('https://onstandard.app/terms', 'clipboard', 'Terms and conditions', 'The full agreement')}
      ${ext('https://onstandard.app/privacy', 'lock', 'Privacy policy', 'What we collect and why')}
      ${ext('https://instagram.com/onstandard', 'camera', 'Instagram', '@onstandard')}
      ${ext('https://x.com/onstandard', 'external', 'X', '@onstandard')}
    </section>

    <h2 class="eyebrow">Account actions</h2>
    <section class="card rows">
      ${/* Two-tap confirm, wired in mount(): a single unguarded tap signed the athlete out, and
            on a shared phone that is one brush of a thumb. Disarms after ~5 seconds. */''}
      <div class="lrow" id="pf-signout" role="button" tabindex="0"><div class="lic">${icon('back', 17)}</div><div class="lm"><div class="lt">Sign out</div><div class="ls pf-hidden" id="pf-signout-sub">You'll need your password to get back in.</div></div></div>
      <div class="lrow" data-go="delete-account"><div class="lic pf-lic-red-ink">${icon('trash', 17)}</div><div class="lm"><div class="lt pf-red">Delete account</div></div>${icon('chevron', 17, 'class="chev-dim"')}</div>
    </section>

    <div class="ac-tail"></div>
    `;
  },
  mount(root) {
    // Sign out arms on the first tap and executes on a second tap within 5 seconds; leaving it
    // alone (or tapping elsewhere and coming back) disarms. Keyboard activation comes from the
    // router's central promotion: no local keydown handler, it would double-fire.
    const signout = root.querySelector('#pf-signout');
    if (signout) {
      const lt = signout.querySelector('.lt');
      const sub = signout.querySelector('#pf-signout-sub');
      let armTimer = null;
      const disarm = () => {
        if (armTimer) { clearTimeout(armTimer); armTimer = null; }
        if (lt) lt.textContent = 'Sign out';
        if (sub) sub.classList.add('pf-hidden');
      };
      signout.addEventListener('click', () => {
        if (armTimer) { disarm(); window.__go('welcome'); return; }
        if (lt) lt.textContent = 'Tap again to sign out';
        if (sub) sub.classList.remove('pf-hidden');
        armTimer = setTimeout(disarm, 5000);
      });
    }
    // The photo control is the shared one (avatar-upload.js); the status line and Remove sit
    // under the name, inside the hero.
    wireAvatarUpload(root, { errHost: '.pf-hero .pf-id', hasLocalPhoto: !!S.athlete.avatar });
  },
};

/* ---------- Edit profile (spec §11): real identity, sport-aware positions ---------- */
// Positions update dynamically with the sport (spec §11.2) — football positions never
// show before football is selected.
export const SPORT_POSITIONS = {
  Football: ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'K', 'P', 'LS', 'Athlete'],
  Basketball: ['Point Guard', 'Shooting Guard', 'Wing', 'Forward', 'Center'],
  Baseball: ['Pitcher', 'Catcher', 'Infield', 'Outfield', 'Utility'],
  Soccer: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'],
  Track: ['Sprints', 'Hurdles', 'Middle Distance', 'Distance', 'Jumps', 'Throws', 'Multis'],
  Volleyball: ['Setter', 'Libero', 'Middle Blocker', 'Outside Hitter', 'Opposite'],
};

export const editProfile = {
  tab: 'profile',
  render() {
    const a = S.athlete;
    const dob = (RT.profile && RT.profile.dob) || '';
    const sport = a.sport && SPORT_POSITIONS[a.sport] ? a.sport : a.sport;
    const positions = SPORT_POSITIONS[sport] || null;
    return `
    ${backHead('Edit profile', 'Only what your coach and score need', 'profile')}

    <h2 class="eyebrow">Name</h2>
    <div style="display:flex;gap:10px">
      <input class="ob-input ep-field" id="ep-first" maxlength="40" value="${esc(a.first === 'Athlete' && !a.last ? '' : a.first)}" placeholder="First name" aria-label="First name" autocomplete="given-name" style="flex:1" />
      <input class="ob-input ep-field" id="ep-last" maxlength="40" value="${esc(a.last)}" placeholder="Last name" aria-label="Last name" autocomplete="family-name" style="flex:1" />
    </div>

    <h2 class="eyebrow">Date of birth</h2>
    ${/* Wrapped because iOS WebKit paints an EMPTY date input as a blank box (it has no
          placeholder support): the hint overlay is the placeholder it refuses to draw, and
          mount() hides it the moment a date lands. */''}
    <div class="ep-dob-wrap">
      <input class="ob-input ep-field${dob ? '' : ' is-empty'}" id="ep-dob" type="date" value="${esc(dob)}" max="${new Date().toISOString().slice(0, 10)}" aria-label="Date of birth" />
      ${dob ? '' : '<span class="ep-dob-hint" aria-hidden="true">Add your birth date</span>'}
    </div>

    <h2 class="eyebrow">Sport</h2>
    <div class="chip-row" id="ep-sport" data-toggle-group>
      ${Object.keys(SPORT_POSITIONS).map(s =>
        `<span class="chip ${sport === s ? 'on' : ''}">${s}</span>`).join('')}
    </div>

    <h2 class="eyebrow">${sport === 'Track' ? 'Event group' : 'Position'}</h2>
    ${positions ? `
    <div class="chip-row" id="ep-pos" data-toggle-group>
      ${positions.map(p => `<span class="chip ${a.position === p ? 'on' : ''}">${p}</span>`).join('')}
    </div>` : `
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);padding:2px 2px 4px">Pick a sport first; positions follow the sport.</div>`}

    <h2 class="eyebrow">School / organization</h2>
    <input class="ob-input ep-field" id="ep-school" maxlength="80" value="${esc(a.school)}" placeholder="Search your school or team" aria-label="School or organization" autocomplete="off" />
    <div id="ep-school-results" class="ep-results" hidden></div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b s38">${icon('lock', 17)}</div>
      <div><div class="tt">That's all we ask for</div>
      <div class="ts">No bios, no socials, no feeds. Goals and weight live in your Standard; this is who your coach sees.</div></div>
    </div>

    <div style="height:16px"></div>
    <div id="ep-err" style="color:var(--red-bright);font-size:13px;font-weight:600;min-height:18px;text-align:center"></div>
    <button class="btn primary" id="ep-save" disabled style="opacity:.5">${icon('check', 19)} Save</button>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const btn = root.querySelector('#ep-save');
    const err = root.querySelector('#ep-err');
    let dirty = false;
    const markDirty = () => {
      if (dirty) return;
      dirty = true;
      btn.disabled = false;
      btn.style.opacity = '1';
      editProfile._dirty = true;
    };
    editProfile._dirty = false;
    root.querySelectorAll('.ep-field').forEach((el) => el.addEventListener('input', markDirty));

    // The native date picker reports through `change` (iOS does not reliably fire `input` for
    // it), and the empty-state hint has to leave the moment a date exists.
    const dobEl = root.querySelector('#ep-dob');
    const dobHint = root.querySelector('.ep-dob-hint');
    if (dobEl) {
      const syncDob = () => {
        markDirty();
        if (dobHint) dobHint.hidden = !!dobEl.value;
        // is-empty blanks the engine's own "mm/dd/yyyy" ghost (flows.css) so the hint above is
        // the ONLY placeholder; it has to leave with the hint or the typed value goes invisible.
        dobEl.classList.toggle('is-empty', !dobEl.value);
      };
      dobEl.addEventListener('change', syncDob);
      dobEl.addEventListener('input', syncDob);
    }

    // Sport chips re-render positions in place (spec §11.2): selecting a sport swaps the
    // position list; the previous selection only survives if it exists in the new sport.
    root.querySelectorAll('#ep-sport .chip').forEach((ch) => ch.addEventListener('click', () => {
      root.querySelectorAll('#ep-sport .chip').forEach((x) => x.classList.remove('on'));
      ch.classList.add('on');
      markDirty();
      const sport = ch.textContent;
      const posWrap = root.querySelector('#ep-pos');
      const list = SPORT_POSITIONS[sport] || [];
      if (posWrap) {
        const prev = posWrap.querySelector('.on') ? posWrap.querySelector('.on').textContent : '';
        posWrap.innerHTML = list.map((p) => `<span class="chip ${p === prev ? 'on' : ''}">${p}</span>`).join('');
        wirePos();
      }
    }));
    const wirePos = () => {
      root.querySelectorAll('#ep-pos .chip').forEach((ch) => ch.addEventListener('click', () => {
        root.querySelectorAll('#ep-pos .chip').forEach((x) => x.classList.remove('on'));
        ch.classList.add('on');
        markDirty();
      }));
    };
    wirePos();

    // School search (spec §11.3): the org directory as you type, free text as fallback.
    const school = root.querySelector('#ep-school');
    const results = root.querySelector('#ep-school-results');
    if (school && results) {
      const search = debounce(async () => {
        const q = school.value.trim();
        if (q.length < 3) { results.hidden = true; return; }
        try {
          const data = await dir.search(q);
          const orgs = (data && data.orgs) || [];
          if (!orgs.length) { results.hidden = true; return; }
          results.innerHTML = orgs.slice(0, 5).map((o) =>
            `<div class="ep-result" data-name="${esc(o.name)}">${esc(o.name)}${o.city || o.state ? `<span>${esc([o.city, o.state].filter(Boolean).join(', '))}</span>` : ''}</div>`).join('');
          results.hidden = false;
          results.querySelectorAll('.ep-result').forEach((r) => r.addEventListener('click', () => {
            school.value = r.getAttribute('data-name');
            results.hidden = true;
            markDirty();
          }));
        } catch { results.hidden = true; /* directory offline — free text still saves */ }
      }, 300);
      school.addEventListener('input', search);
    }

    btn.addEventListener('click', async () => {
      const first = root.querySelector('#ep-first').value.trim();
      const last = root.querySelector('#ep-last').value.trim();
      const dob = root.querySelector('#ep-dob').value;
      const schoolV = root.querySelector('#ep-school').value.trim();
      const sport = root.querySelector('#ep-sport .on')?.textContent || '';
      const position = root.querySelector('#ep-pos .on')?.textContent || '';
      // Inline validation (spec §11.4). Never let a blank name wipe the identity.
      if (!first) { err.textContent = 'Add your first name: your coach sees it on every log.'; return; }
      if (!last) { err.textContent = 'Add your last name.'; return; }
      if (dob) {
        const d = new Date(dob + 'T12:00:00');
        const age = (Date.now() - d.getTime()) / (365.25 * 86400000);
        if (isNaN(d.getTime()) || age < 5 || age > 100) { err.textContent = 'Check your date of birth.'; return; }
        // The server's 0210 age lock is one-way: once a birth date says "under 18" only a
        // parent or support can raise it again. So an under-18 date from someone the app
        // currently believes is an adult (or has no date for) takes a second, explicit Save —
        // an adult who fat-fingers the year shouldn't lock themselves out of their own account.
        const cur = (RT.profile && RT.profile.dob) || '';
        const curMinor = cur ? (Date.now() - new Date(cur + 'T12:00:00').getTime()) / (365.25 * 86400000) < 18 : false;
        if (age < 18 && !curMinor && editProfile._minorConfirm !== dob) {
          editProfile._minorConfirm = dob;
          err.textContent = 'This birth date says you’re under 18. That turns on the protections for minors, and only a parent or support can undo it. Tap Save again to confirm.';
          return;
        }
      }
      err.textContent = '';
      btn.disabled = true;
      const was = btn.innerHTML; // innerHTML, not textContent: the label carries the check icon SVG, and a failed save used to hand back a de-iconed button
      btn.textContent = 'Saving…';
      const name = `${first} ${last}`.trim();
      // Local first (instant), then the SERVER write the coach actually reads. dob is the
      // exception: the server can REFUSE it (0210 age lock), so it only lands locally after
      // the server takes it — otherwise this screen would show a birth date the server rejected.
      window.__act.saveProfile({ name, school: schoolV, sport, position });
      const ok = await window.__act.saveIdentity({ full_name: name, sport, position, school: schoolV });
      let dobOk = true;
      if (dob) {
        const r = await window.__act.setMyDob(dob);
        if (r.reason === 'locked') { err.textContent = 'Your birth date is locked while you’re under 18. A parent or support can correct it.'; btn.disabled = false; btn.innerHTML = was; return; }
        if (r.reason === 'floor') { err.textContent = 'OnStandard is for athletes 13 and up.'; btn.disabled = false; btn.innerHTML = was; return; }
        dobOk = r.ok;
        if (r.ok) window.__act.saveProfile({ dob });
      }
      // dob has no background retry and (unlike the rest) wasn't kept locally on failure, so
      // "it'll sync" would be a lie for it — name that failure specifically.
      if (dobOk === false && ok !== false) { err.textContent = 'Couldn’t save your birth date. Check your connection and try again.'; btn.disabled = false; btn.innerHTML = was; return; }
      if (ok === false) { err.textContent = 'Saved on this phone, couldn’t reach the server. It’ll sync when you’re back online.'; btn.disabled = false; btn.innerHTML = was; return; }
      editProfile._dirty = false;
      btn.textContent = 'Saved';
      setTimeout(() => window.__back('profile'), 350);
    });

    // Unsaved-change warning (spec §11.4): leaving with edits asks once.
    root.querySelectorAll('[data-back]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (editProfile._dirty && !window.confirm('Discard your unsaved changes?')) {
          e.stopImmediatePropagation();
          e.preventDefault();
        } else {
          editProfile._dirty = false;
        }
      }, { capture: true });
    });
  },
};
