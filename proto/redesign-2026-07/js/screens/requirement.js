import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { CATALOG, PROOF, IMPACT_LABEL, freqLabel, fmtMin, deriveAssigned, catalogFromItems } from '../requirements.js';
import { DAY } from '../day.js';

/* Requirement Detail — every rule in the system is legible: what it is, when,
   what proof, what it touches, and the coach's why. One screen serves the whole
   catalog + coach-assigned tasks (proof-type routing decides the action). */
export default {
  tab: 'home',
  render({ sub }) {
    const id = sub || 'dinner';
    const assigned = RT.assigned.find(a => a.id === id);
    // Resolve from the live rulebook (S.scheduleCatalog) first — it carries the classic snack row
    // and, under a coach standard, the TRUE meal windows (the raw CATALOG would print a classic
    // deadline a coach has moved) — then the built-in CATALOG, then the coach's standing set items
    // (lift/custom/extra weigh etc.), so a coach NON-MEAL requirement opens a real detail screen.
    const req = assigned ? deriveAssigned(assigned)
      : ((S.scheduleCatalog || []).find(r => r.id === id) || CATALOG.find(r => r.id === id) || catalogFromItems(RT.stdItems).find(r => r.id === id));
    // Unknown id (stale deep-link, removed assigned task): a legible empty state with a
    // forward path, not a bare "Nothing here" dead end.
    if (!req) return `${backHead('Requirement', 'Not found', 'plan')}
    <div class="state-demo">
      <div class="sd-ic">${icon('clipboard', 26)}</div>
      <div class="sd-t">This requirement isn't on your Standard</div>
      <div class="sd-s">It may have been removed by your coach or already wrapped up. Your current rules and tasks live on your Plan.</div>
      <div class="sd-cta"><button class="btn primary" data-go="plan">${icon('clipboard', 18)} Go to your Plan</button></div>
    </div>`;

    const proof = PROOF[req.proof] || PROOF.check;
    const impact = IMPACT_LABEL[req.impact.kind === 'component' ? req.impact.comp : req.impact.kind];
    // A standing NON-MEAL check requirement (coach lift/custom) completes one-tap into the per-day
    // checked store — tracked, not scored. Its done-state reads from DAY.checkedTasks (toggle to undo).
    const isStandingCheck = !assigned && req.proof === 'check';
    const checkDone = isStandingCheck && !!(DAY.checkedTasks && DAY.checkedTasks[id]);
    const done = assigned ? assigned.done : checkDone;

    // Training/lift (0135): the standing lift item opens a lightweight log (title + how'd it go +
    // notes) instead of a one-tap check. Carries the coach's programmed session (title/desc).
    const stdItem = (RT.stdItems || []).find((i) => i.id === id) || null;
    const isTraining = !assigned && stdItem && stdItem.kind === 'lift';

    let actionBtn = assigned
      ? (done
        ? `<div class="day-done"><div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
           <div><div class="tt">Done. ${assigned.from} can see it.</div><div class="ts">Completed tonight.</div></div></div>`
        : `<button class="btn green" data-act="completeAssigned:${id}" data-then="requirement/${id}">${icon('check', 19)} Mark Done · coach sees it</button>`)
      : isStandingCheck
        ? (checkDone
          ? `<button class="btn ghost" data-act="completeCheck:${id}" data-then="requirement/${id}" style="width:100%">${icon('check', 19)} Done · coach sees it · tap to undo</button>`
          : `<button class="btn green" data-act="completeCheck:${id}" data-then="requirement/${id}">${icon('check', 19)} Mark Done · coach sees it</button>`)
        : `<button class="btn primary" data-go="${req.route || proof.route || 'home'}">${icon(req.icon, 19)} ${proof.verb} ${req.title}</button>`;

    /* "What counts as completion" — the question the proof label only half answered. Each line is
       the ENGINE's real rule, not a description of one: meals run on day.js's on-time/late-credit
       split (grace minutes ride the requirement when a coach set them), and a tracked-not-scored
       row says plainly that late costs nothing because nothing was ever at stake. */
    const grace = typeof req.grace === 'number' && req.grace > 0 ? req.grace : 0;
    const scored = req.impact.kind === 'component';
    const DONE_RULE = {
      photo: { what: 'A photo of the plate', late: `Logged inside the window scores in full${grace ? `, plus ${grace} min grace` : ''}. Late still counts, at half credit.` },
      form:  { what: 'The form submitted', late: 'Submitted any time tonight counts in full.' },
      scale: { what: 'A weight entered', late: 'It feeds your season trend, so a late entry costs nothing.' },
      counter: { what: 'The count reached', late: 'Add to it any time before the deadline.' },
      check: { what: 'One tap to mark it done', late: assigned ? 'Your coach sees it either way.' : 'No deadline penalty.' },
    };
    const doneRule = DONE_RULE[req.proof] || DONE_RULE.check;
    if (!scored) doneRule.late = 'Tracked, not scored. Logging late costs you nothing.';

    /* Who set this rule, and when it last changed. Attributed ONLY when a coach requirement_set
       actually governs: with none, these are the app's built-in defaults and naming a person
       would be a fabrication. Coach-assigned tasks carry their own real assigner. */
    const gov = S.governingStandard;
    const fmtDate = (iso) => {
      if (!iso) return null;
      const d = new Date(String(iso).length <= 10 ? `${iso}T12:00:00` : iso);
      return isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };
    const provenance = assigned
      ? { who: `Assigned by ${assigned.from || 'your coach'}`, when: assigned.dueLabel || 'One-time task' }
      : gov
        ? {
          who: gov.setBy ? `${gov.scopeLabel} by ${gov.setBy}` : gov.scopeLabel,
          when: gov.effectiveDate ? `In effect since ${fmtDate(gov.effectiveDate) || gov.effectiveDate}`
            : gov.updatedAt ? `Last changed ${fmtDate(gov.updatedAt) || gov.updatedAt}` : 'In effect now',
        }
        : { who: 'The OnStandard baseline', when: 'Not replaced by a coach standard' };

    // Training override: route to the lightweight session log rather than a one-tap check.
    if (isTraining) actionBtn = checkDone
      ? `<button class="btn ghost" data-go="log-training/${id}" style="width:100%">${icon('check', 19)} Logged today · tap to update</button>`
      : `<button class="btn green" data-go="log-training/${id}">${icon('bolt', 19)} Log this session</button>`;

    // An optional row (the classic snack) must never introduce itself as "Required daily" —
    // freqLabel only speaks for required frequencies.
    const freqText = req.required === false ? 'Optional · skipping is never a miss' : freqLabel(req.freq);

    return `
    ${backHead(req.title, assigned ? `Assigned by ${assigned.from}` : freqText, 'home')}

    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('clock', 17)}</div>
        ${/* "Deadline set" was a label standing in for a deadline this screen already has: the
              catalog carries the minute, and derive() (which builds dueLabel) never runs on this
              route. Print the time. */''}
        <div class="lm"><div class="lt">${req.dueLabel || (req.window && req.window.due != null ? `Due by ${fmtMin(req.window.due)}` : 'No deadline')}</div>
        <div class="ls">${assigned ? 'One-time task' : freqText}</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('camera', 17)}</div>
        <div class="lm"><div class="lt">${proof.label}</div><div class="ls">How you prove it</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('target', 17)}</div>
        <div class="lm"><div class="lt">${impact}</div><div class="ls">What it touches. No black boxes</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('check', 17)}</div>
        <div class="lm"><div class="lt">${esc(doneRule.what)}</div><div class="ls">${esc(doneRule.late)}</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('bell', 17)}</div>
        <div class="lm"><div class="lt">Reminders: ${req.reminder || 'medium'}</div><div class="ls">Coach sets urgency; you set quiet hours</div></div>
      </div>
      ${provenance ? `
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('shield', 17)}</div>
        <div class="lm"><div class="lt">${esc(provenance.who)}</div><div class="ls">${esc(provenance.when)}</div></div>
      </div>` : ''}
    </section>

    <div class="eyebrow">Why it's on your standard</div>
    <div class="coachnote">
      ${(() => {
        // Real attribution only: an assigned task credits its real assigner; a catalog rule
        // credits the athlete's real linked coach — never a fabricated persona.
        const who = assigned ? (assigned.from || '') : (S.coach.hasCoach && S.coach.isNamed ? S.coach.name : '');
        if (!who) return '';
        const init = who.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
        return `<div class="who"><div class="av">${esc(init)}</div><div><div class="nm">${esc(who)}</div><div class="rl">${assigned ? 'On this task' : 'On this requirement'}</div></div></div>`;
      })()}
      ${req.note ? `<p>“${esc(req.note)}”</p>` : ''}
    </div>

    ${isTraining && stdItem.desc ? `
    <div class="eyebrow">The session</div>
    <div class="coachnote"><p>${esc(stdItem.desc)}</p></div>` : ''}

    <div style="height:18px"></div>
    ${actionBtn}
    <div style="height:10px"></div>
    `;
  },
  mount() { if (window.__act) window.__act.seeAssigned(); },
};
