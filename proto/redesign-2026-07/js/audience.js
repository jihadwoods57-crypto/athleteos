/* Audience — the ONE "who gets this" picker for operator composers.
   Five composers grew five different "who" models (team/room/every-athlete-as-a-chip, team/room/
   group, team-only, route-only). A coach could not say "these six" anywhere except by first saving
   a group from roster Select mode. This module owns the model and the markup so every composer
   asks the same question the same way:

     Everyone · N   |  <room> · n …  |  <group> · n …  |  Pick people · k

   "Pick people" opens a searchable, multi-select list of full names (first-name chips were
   ambiguous the moment a roster had two Marcuses). The picker patches ITSELF in place on every
   tap — a full window.__render() per selection is what forced the old composers to snapshot
   their own text inputs before each repaint.

   Pure functions first (tested), markup + wiring after. No inline styles: the classes live in
   css/coach.css under .aud-*. */
import { icon } from './icons.js';
import { initialsOf } from './initials.js';

/* Local escape, not components.js's: that module drags state.js in, which touches `window` at
   import time, and the pure functions here are unit-tested under plain node. Same table. */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]); }
/* Avatars hydrate lazily for the same reason: avatar.js is browser-only. */
const hydrateAvatars = (el) => { import('./avatar.js').then((m) => m.hydrateAvatars(el)).catch(() => {}); };

export const AUDIENCE_KINDS = ['team', 'position', 'group', 'athletes'];

/** A fresh audience: everyone. */
export function everyone() { return { kind: 'team', value: null, ids: [] }; }
/** An audience of exactly these people (roster Select → Assign, or an athlete-screen deep link). */
export function people(ids) { return { kind: 'athletes', value: null, ids: [...new Set((ids || []).filter(Boolean))] }; }

const unit = (r) => (r.unit || r.position || '').trim().toUpperCase();

/** Rooms present on this roster, in first-seen order. A practice has none (units are null there). */
export function roomsOf(rows) {
  return [...new Set((rows || []).map(unit).filter(Boolean))];
}

/** The athlete ids an audience means, by the SAME match rules the server fans out with
    (assign_requirement: team → every active member; position → upper(position) equality). */
export function audienceIds(aud, rows, groups) {
  const list = rows || [];
  if (!aud || aud.kind === 'team') return list.map((r) => r.athleteId);
  if (aud.kind === 'position') return list.filter((r) => unit(r) === String(aud.value || '').toUpperCase()).map((r) => r.athleteId);
  if (aud.kind === 'group') {
    const g = (groups || []).find((x) => x.id === aud.value);
    const on = new Set(list.map((r) => r.athleteId));
    // Only members still on the roster: a group can outlive a departure, and the server would
    // refuse (or skip) an id that is no longer an active member.
    return ((g && g.athlete_ids) || []).filter((id) => on.has(id));
  }
  const on = new Set(list.map((r) => r.athleteId));
  return (aud.ids || []).filter((id) => on.has(id));
}

/** Plain-English audience, for a send button and a confirmation: "the whole team", "the WR room",
    "Starters", "Marcus Reed", "3 athletes". */
export function audienceLabel(aud, rows, groups, { noun = 'athlete', nouns = 'athletes', everyoneWord = 'the whole team' } = {}) {
  if (!aud || aud.kind === 'team') return everyoneWord;
  if (aud.kind === 'position') return `the ${String(aud.value || '').toUpperCase()} room`;
  if (aud.kind === 'group') { const g = (groups || []).find((x) => x.id === aud.value); return g ? g.name : 'the group'; }
  const ids = audienceIds(aud, rows, groups);
  if (ids.length === 1) { const r = (rows || []).find((x) => x.athleteId === ids[0]); return r ? r.name : `1 ${noun}`; }
  return `${ids.length} ${ids.length === 1 ? noun : nouns}`;
}

/** The RPC calls a send needs. assign_requirement knows team / position / ONE athlete, so a group
    or a hand-picked set fans out client-side, one call per person, and the caller reports each
    result honestly (never "Sent" when three of five landed). */
export function planSends(aud, rows, groups) {
  if (!aud || aud.kind === 'team') return [{ scopeKind: 'team', scopeValue: null }];
  if (aud.kind === 'position') return [{ scopeKind: 'position', scopeValue: String(aud.value || '').toUpperCase() }];
  return audienceIds(aud, rows, groups).map((id) => ({ scopeKind: 'athlete', scopeValue: id }));
}

/** First names for a summary line: "Marcus, DeShawn and 2 more". */
export function namesSummary(ids, rows, max = 3) {
  const names = (ids || []).map((id) => { const r = (rows || []).find((x) => x.athleteId === id); return r ? (r.name.split(' ')[0] || r.name) : null; }).filter(Boolean);
  if (!names.length) return '';
  if (names.length <= max) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/* ---------------- markup ---------------- */

function chip(on, label, act, arg) {
  return `<span class="chip ${on ? 'on' : ''}" role="radio" aria-checked="${on ? 'true' : 'false'}" tabindex="0" data-aud="${act}${arg != null ? ':' + esc(String(arg)) : ''}">${label}</span>`;
}

function personRow(r, on) {
  return `<div class="aud-row" role="checkbox" aria-checked="${on ? 'true' : 'false'}" tabindex="0" data-aud-id="${esc(r.athleteId)}" aria-label="${esc(r.name)}">
    <span class="aud-box" aria-hidden="true">${icon('check', 12)}</span>
    <span class="ros-av" data-avatar-uid="${esc(r.athleteId)}" aria-hidden="true"><span data-avatar-fallback>${esc(initialsOf(r.name, '?'))}</span></span>
    <span class="aud-name">${esc(r.name)}${unit(r) ? `<small>· ${esc(unit(r))}</small>` : ''}</span>
  </div>`;
}

function listHtml(rows, ids, q) {
  const needle = (q || '').trim().toLowerCase();
  const list = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  if (!list.length) return `<div class="aud-none">No one matches “${esc(q)}”.</div>`;
  const on = new Set(ids);
  return list.map((r) => personRow(r, on.has(r.athleteId))).join('');
}

function summaryHtml(aud, rows, groups, nouns) {
  const ids = audienceIds(aud, rows, groups);
  if (!ids.length) return `Tap the ${nouns} this is for.`;
  return `<b>${ids.length} picked</b> · ${esc(namesSummary(ids, rows))}`;
}

/** The picker's markup. `rows` is the roster (CD.roster.rows), `groups` is CD.extras.groups.
    A practice book passes `practice: true`: no rooms, and "Everyone" reads "All clients". */
export function audienceHtml(aud, { rows = [], groups = [], practice = false, nouns = 'athletes', query = '' } = {}) {
  const rooms = practice ? [] : roomsOf(rows);
  const picked = aud.kind === 'athletes' ? audienceIds(aud, rows, groups).length : 0;
  return `<div class="aud" id="aud">
    <div class="chip-row" role="radiogroup" aria-label="Who">
      ${chip(aud.kind === 'team', `${practice ? 'All clients' : 'Whole team'}${rows.length ? ` · ${rows.length}` : ''}`, 'team')}
      ${rooms.map((p) => chip(aud.kind === 'position' && String(aud.value).toUpperCase() === p, `${esc(p)} room · ${rows.filter((r) => unit(r) === p).length}`, 'position', p)).join('')}
      ${(practice ? [] : groups).map((g) => chip(aud.kind === 'group' && aud.value === g.id, `${esc(g.name)} · ${audienceIds({ kind: 'group', value: g.id }, rows, groups).length}`, 'group', g.id)).join('')}
      ${rows.length ? chip(aud.kind === 'athletes', `${icon('users', 13)} Pick people${picked ? ` · ${picked}` : ''}`, 'athletes') : ''}
    </div>
    ${aud.kind === 'athletes' ? `
    <div class="aud-pick">
      <div class="aud-tools">
        <input class="ob-input" id="aud-q" type="search" aria-label="Search ${esc(nouns)}" placeholder="Search ${esc(nouns)}" value="${esc(query)}" autocomplete="off" />
        <button class="btn ghost xs" type="button" data-aud-all>${picked === rows.length && rows.length ? 'Clear' : 'All'}</button>
      </div>
      <div class="aud-list" id="aud-list" role="group" aria-label="${esc(nouns)}">${listHtml(rows, aud.ids, query)}</div>
      <div class="aud-sum" id="aud-sum" aria-live="polite">${summaryHtml(aud, rows, groups, nouns)}</div>
    </div>` : ''}
  </div>`;
}

/** Wire the picker inside `root`. Mutates `aud` in place and calls onChange(aud) after every
    change. Everything repaints inside #aud only — the composer around it keeps its typed text,
    focus and scroll. */
export function wireAudience(root, aud, opts = {}) {
  const { rows = [], groups = [], onChange = () => {} } = opts;
  const host = () => root.querySelector('#aud');
  let query = opts.query || '';
  const repaint = () => {
    const el = host(); if (!el) return;
    el.outerHTML = audienceHtml(aud, { ...opts, query });
    wire();
    onChange(aud);
  };
  const patchRow = (id) => {
    const el = host(); if (!el) return;
    const on = aud.ids.includes(id);
    const row = el.querySelector(`[data-aud-id="${CSS.escape(id)}"]`);
    if (row) row.setAttribute('aria-checked', on ? 'true' : 'false');
    const sum = el.querySelector('#aud-sum');
    if (sum) sum.innerHTML = summaryHtml(aud, rows, groups, opts.nouns || 'athletes');
    const pick = el.querySelector('[data-aud="athletes"]');
    const n = audienceIds(aud, rows, groups).length;
    if (pick) pick.innerHTML = `${icon('users', 13)} Pick people${n ? ` · ${n}` : ''}`;
    const all = el.querySelector('[data-aud-all]');
    if (all) all.textContent = n === rows.length && rows.length ? 'Clear' : 'All';
    onChange(aud);
  };
  function wire() {
    const el = host(); if (!el) return;
    el.querySelectorAll('[data-aud]').forEach((c) => c.addEventListener('click', () => {
      const [act, arg] = c.getAttribute('data-aud').split(':');
      if (act === 'team') { aud.kind = 'team'; aud.value = null; }
      else if (act === 'position') { aud.kind = 'position'; aud.value = arg; }
      else if (act === 'group') { aud.kind = 'group'; aud.value = arg; }
      else if (act === 'athletes') { if (aud.kind === 'athletes') return; aud.kind = 'athletes'; aud.value = null; }
      repaint();
      if (act === 'athletes') { const q = host() && host().querySelector('#aud-q'); if (q && !aud.ids.length) q.focus(); }
    }));
    el.querySelectorAll('[data-aud-id]').forEach((r) => r.addEventListener('click', () => {
      const id = r.getAttribute('data-aud-id');
      aud.ids = aud.ids.includes(id) ? aud.ids.filter((x) => x !== id) : [...aud.ids, id];
      patchRow(id);
    }));
    const all = el.querySelector('[data-aud-all]');
    if (all) all.addEventListener('click', () => {
      const every = rows.map((r) => r.athleteId);
      aud.ids = aud.ids.length === every.length ? [] : every;
      repaint();
    });
    const q = el.querySelector('#aud-q');
    if (q) {
      let t = null;
      q.addEventListener('input', () => {
        query = q.value;
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          t = null;
          const list = el.querySelector('#aud-list');
          if (!list) return;
          list.innerHTML = listHtml(rows, aud.ids, query);
          list.querySelectorAll('[data-aud-id]').forEach((r) => r.addEventListener('click', () => {
            const id = r.getAttribute('data-aud-id');
            aud.ids = aud.ids.includes(id) ? aud.ids.filter((x) => x !== id) : [...aud.ids, id];
            patchRow(id);
          }));
          hydrateAvatars(list);
        }, 120);
      });
    }
    hydrateAvatars(el);
  }
  wire();
}
