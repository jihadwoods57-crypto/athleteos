/* Log a training session — lightweight (0135): session name (prefilled from the coach's programmed
   session), a 1–5 "how'd it go", optional notes. Saves a training_logs row (coach-visible) and marks
   the requirement done in days.checked_tasks — TRACKED, NOT SCORED (never touches the daily score).
   Reached from the training requirement detail, or as a solo self-log (no sub) from Training history. */
import { RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import * as roles from '../roles.js';
import { DAY } from '../day.js';

export default {
  tab: 'home',
  transient: true, // form screen: saving hands off — never a back-target
  render({ sub }) {
    const id = sub || '';
    const stdItem = id ? (RT.stdItems || []).find((i) => i.id === id) : null;
    const coachTitle = stdItem && stdItem.title && stdItem.title !== 'Lift session' ? stdItem.title : '';
    const desc = stdItem && stdItem.desc ? stdItem.desc : '';
    const alreadyDone = !!(id && DAY.checkedTasks && DAY.checkedTasks[id]);
    return `
    ${backHead('Log training', coachTitle || (id ? 'Your session' : 'A workout you did'), id ? `requirement/${id}` : 'training-history')}
    ${desc ? `<div class="eyebrow">The session</div><div class="coachnote"><p>${esc(desc)}</p></div><div style="height:12px"></div>` : ''}
    <section class="card pad">
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Session</div>
      <input class="ob-input" id="tl-title" maxlength="80" placeholder="e.g. Lower Body A" value="${esc(coachTitle)}" />
      <div style="height:14px"></div>
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:8px">How’d it go?</div>
      <div class="chips5" id="tl-feel" role="radiogroup" aria-label="How'd it go, 1 to 5">
        ${[1, 2, 3, 4, 5].map((n) => `<div class="c5" data-feel="${n}" role="radio" aria-checked="false" aria-label="${n} of 5">${n}</div>`).join('')}
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--text-3);display:flex;justify-content:space-between;margin-top:6px"><span>Rough</span><span>Great</span></div>
      <div style="height:14px"></div>
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Notes <span style="color:var(--text-3);font-weight:600">· optional</span></div>
      <textarea class="ob-input" id="tl-note" maxlength="1000" rows="3" style="min-height:72px;resize:vertical" placeholder="What you did, how you felt, anything to tell your coach"></textarea>
    </section>
    <div style="height:14px"></div>
    <button class="btn green" id="tl-save" style="width:100%">${icon('check', 19)} ${alreadyDone ? 'Update log' : `Log it${id ? ' · coach sees it' : ''}`}</button>
    <div style="height:10px"></div>`;
  },
  mount(root, { sub }) {
    const id = sub || '';
    // Feel selection is DOM-local (no re-render) so the form never resets mid-entry.
    let feel = 0;
    root.querySelectorAll('#tl-feel .c5').forEach((el) => el.addEventListener('click', () => {
      root.querySelectorAll('#tl-feel .c5').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
      el.classList.add('on'); el.setAttribute('aria-checked', 'true');
      feel = +el.getAttribute('data-feel');
    }));
    const save = root.querySelector('#tl-save');
    if (save) save.addEventListener('click', async () => {
      if (save.disabled) return;
      save.disabled = true; save.textContent = 'Saving…';
      const title = ((root.querySelector('#tl-title') || {}).value || '').trim();
      const note = ((root.querySelector('#tl-note') || {}).value || '').trim();
      const row = await roles.saveTrainingLog(RT.userId, {
        title, note, feel: feel || null, source: id ? 'coach' : 'self', requirementId: id || null,
      });
      // Mark the requirement done (tracked-not-scored) so Home + the coach's status reflect it.
      if (id && act && act.markCheckDone) { try { act.markCheckDone(id); } catch { /* best-effort */ } }
      if (row !== null) { if (window.__go) window.__go(id ? 'home' : 'training-history'); }
      else { save.disabled = false; save.textContent = 'Save failed — try again'; }
    });
  },
};
