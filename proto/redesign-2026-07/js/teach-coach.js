/* Lessons and team challenges, the coach's reads and the Home door (goals and eating plan, D).
 *
 * Painted into #tc-slot on operator Home by dynamic import (the season and dining seam): nothing
 * here is in the boot graph and a slow read never delays the queue. Team books only.
 *
 * WHO. Every active staffer of the team READS progress (0256 team_lessons / team_challenge_board:
 * is_staff_of_team). Only the standards editors (0252 can_set_team_phase; staff-access.js
 * canSetTargets, the same list) assign a lesson or start and end a challenge, and the controls for
 * that fail CLOSED while the role loads: view-only staff never see an Assign or Start button.
 */
import { CD, bookId, loadBook } from './coach-data.js';
import { esc } from './components.js';
import { icon } from './icons.js';
import { canSetTargets } from './staff-access.js';
import { habitTitle, teamLine } from './challenge-model.js';
import { todayISO } from './roles.js';

const TTL = 60000;
let TC = { team: null, lessons: null, lessonsAt: 0, board: undefined, boardAt: 0, err: false };

export const teach = () => TC;
export const isTeamBook = () => CD.kind === 'team' && !!bookId();
/** Assign lessons and run challenges: a team's standards editor on a live plan. Fails closed. */
export function canTeach() {
  return isTeamBook() && !!(CD.caps && CD.caps.standards) && !!(CD.extras && canSetTargets(CD.extras.myRole));
}
/** Read progress: any staffer of the team, once the book (and so the role) has loaded. */
export const canRead = () => isTeamBook() && !!CD.extras;

function sameTeam() {
  const team = bookId();
  if (TC.team !== team) TC = { team, lessons: null, lessonsAt: 0, board: undefined, boardAt: 0, err: false };
  return team;
}

/** The team's assignments with their done counts (0256 team_lessons). true when it changed. */
export async function readLessons(force = false) {
  const team = sameTeam();
  const sb = window.sb;
  if (!team || !sb) return false;
  if (!force && TC.lessons && Date.now() - TC.lessonsAt < TTL) return false;
  try {
    const { data, error } = await sb.rpc('team_lessons', { p_team: team });
    if (error) { TC.err = true; return false; }
    const next = Array.isArray(data) ? data : [];
    const changed = JSON.stringify(next) !== JSON.stringify(TC.lessons);
    TC = { ...TC, lessons: next, lessonsAt: Date.now(), err: false };
    return changed;
  } catch { TC.err = true; return false; }
}

/** The team's latest challenge and everyone's progress (0256 team_challenge_board). */
export async function readBoard(force = false) {
  const team = sameTeam();
  const sb = window.sb;
  if (!team || !sb) return false;
  if (!force && TC.board !== undefined && Date.now() - TC.boardAt < TTL) return false;
  try {
    const { data, error } = await sb.rpc('team_challenge_board', { p_team: team, p_challenge: null, p_today: todayISO() });
    if (error) { TC.err = true; return false; }
    const next = data && data.challenge ? data : null;
    const changed = JSON.stringify(next) !== JSON.stringify(TC.board);
    TC = { ...TC, board: next, boardAt: Date.now(), err: false };
    return changed;
  } catch { TC.err = true; return false; }
}

/** Forget the reads (after a write) so the next paint asks again. */
export function dropTeachReads() { TC = { ...TC, lessonsAt: 0, boardAt: 0 }; }

/** Announce a new assignment or challenge, once (send-push teach_push -> 0256 claim_teach_push).
 *  Best effort and never awaited by a screen: the row is already saved. */
export function announce(kind, id) {
  const sb = window.sb;
  if (!sb || !id) return Promise.resolve(false);
  return sb.functions.invoke('send-push', { body: { teach_push: { kind, id } } }).then(({ error }) => !error, () => false);
}

/** "Protein at breakfast · 14 of 22 on track" and where it goes, or null for no row. */
export function challengeValue(board, today, editor) {
  const c = board && board.challenge;
  if (c && !c.ended_at && today <= c.ends_on) {
    const started = c.starts_on <= today;
    const line = started ? teamLine({ onTrack: board.on_track, total: board.total }) : 'Starts soon';
    return { text: [habitTitle(c.habit), line].filter(Boolean).join(' · '), go: 'coach-challenge', cta: 'Open', unset: false };
  }
  if (!editor) return null;
  return { text: 'Rally the team around one habit', go: 'coach-challenge/new', cta: 'Start one', unset: true };
}

/** "2 assigned · 14 of 22 done on the latest", or null for no row. */
export function lessonsValue(lessons, editor) {
  const list = Array.isArray(lessons) ? lessons : [];
  if (list.length) {
    const last = list[0];
    const n = `${list.length} assigned`;
    const t = Number(last.total) || 0;
    return { text: t ? `${n} · ${last.done} of ${t} done on the latest` : n, go: 'coach-lessons', cta: 'Open', unset: false };
  }
  if (!editor) return null;
  return { text: 'Assign a 60-second lesson', go: 'coach-lessons/assign', cta: 'Assign', unset: true };
}

export function teachControlsHtml() {
  if (!canRead() || TC.team !== bookId()) return '';
  const editor = canTeach();
  const today = todayISO();
  const rows = [];
  if (TC.board !== undefined) {
    const v = challengeValue(TC.board, today, editor);
    if (v) rows.push(['target', 'Team challenge', v]);
  }
  if (TC.lessons) {
    const v = lessonsValue(TC.lessons, editor);
    if (v) rows.push(['fileText', 'Lessons', v]);
  }
  return rows.map(([ic, k, v]) => `<button type="button" class="sp-ctl tc-ctl" data-go="${esc(v.go)}">
    <span class="sp-ic tc-ic">${icon(ic, 18)}</span>
    <span class="sp-tx"><span class="sp-k">${esc(k)}</span><span class="sp-v${v.unset ? ' unset' : ''}">${esc(v.text)}</span></span>
    <span class="sp-go">${esc(v.cta)}${icon('chevron', 13)}</span>
  </button>`).join('');
}

export function paintTeach(root) {
  const slot = root.querySelector('#tc-slot');
  if (!slot) return;
  const paint = () => { if (slot.isConnected) slot.innerHTML = teachControlsHtml(); };
  paint();
  const go = () => {
    if (!canRead()) return;
    void Promise.all([readBoard(false), readLessons(false)]).then(paint, () => {});
  };
  if (CD.kind === 'team' && !CD.extras) void Promise.resolve(loadBook(false, 'team')).then(go);
  else go();
}

/** Is the board's challenge the one still running (or about to start)? */
export const boardOpen = (board, today) => !!(board && board.challenge && !board.challenge.ended_at && today <= board.challenge.ends_on);

/* Tests only. */
export function _seedTeach(s) { TC = { team: bookId(), lessons: null, lessonsAt: Date.now(), board: undefined, boardAt: Date.now(), err: false, ...s }; }
