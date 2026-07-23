import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { CATALOG, PROOF, IMPACT_LABEL, freqLabel, deriveAssigned, catalogFromItems } from '../requirements.js';
import { DAY } from '../day.js';

/* Requirement Detail — every rule in the system is legible: what it is, when,
   what proof, what it touches, and the coach's why. One screen serves the whole
   catalog + coach-assigned tasks (proof-type routing decides the action). */
export default {
  tab: 'home',
  render({ sub }) {
    const id = sub || 'dinner';
    const assigned = RT.assigned.find(a => a.id === id);
    // Resolve from the built-in CATALOG first, then the coach's standing set items (lift/custom/extra
    // hydration/weigh), so a coach NON-MEAL requirement opens a real detail screen, not "not found".
    const req = assigned ? deriveAssigned(assigned) : (CATALOG.find(r => r.id === id) || catalogFromItems(RT.stdItems).find(r => r.id === id));
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

    const actionBtn = assigned
      ? (done
        ? `<div class="day-done"><div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
           <div><div class="tt">Done. ${assigned.from} can see it.</div><div class="ts">Completed tonight.</div></div></div>`
        : `<button class="btn green" data-act="completeAssigned:${id}" data-then="requirement/${id}">${icon('check', 19)} Mark Done · coach sees it</button>`)
      : isStandingCheck
        ? (checkDone
          ? `<button class="btn ghost" data-act="completeCheck:${id}" data-then="requirement/${id}" style="width:100%">${icon('check', 19)} Done · coach sees it · tap to undo</button>`
          : `<button class="btn green" data-act="completeCheck:${id}" data-then="requirement/${id}">${icon('check', 19)} Mark Done · coach sees it</button>`)
        : `<button class="btn primary" data-go="${req.route || proof.route || 'home'}">${icon(req.icon, 19)} ${proof.verb} ${req.title}</button>`;

    return `
    ${backHead(req.title, assigned ? `Assigned by ${assigned.from}` : freqLabel(req.freq), 'home')}

    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('clock', 17)}</div>
        <div class="lm"><div class="lt">${req.dueLabel || (req.window && req.window.due ? 'Deadline set' : 'No deadline')}</div>
        <div class="ls">${assigned ? 'One-time task' : freqLabel(req.freq)}</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('camera', 17)}</div>
        <div class="lm"><div class="lt">${proof.label}</div><div class="ls">How you prove it</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('target', 17)}</div>
        <div class="lm"><div class="lt">${impact}</div><div class="ls">What it touches — no black boxes</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('bell', 17)}</div>
        <div class="lm"><div class="lt">Reminders: ${req.reminder || 'medium'}</div><div class="ls">Coach sets urgency; you set quiet hours</div></div>
      </div>
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

    <div style="height:18px"></div>
    ${actionBtn}
    <div style="height:10px"></div>
    `;
  },
  mount() { if (window.__act) window.__act.seeAssigned(); },
};
