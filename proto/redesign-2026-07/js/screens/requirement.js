import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';
import { CATALOG, PROOF, IMPACT_LABEL, freqLabel, deriveAssigned } from '../requirements.js';

/* Requirement Detail — every rule in the system is legible: what it is, when,
   what proof, what it touches, and the coach's why. One screen serves the whole
   catalog + coach-assigned tasks (proof-type routing decides the action). */
export default {
  tab: 'home',
  render({ sub }) {
    const id = sub || 'dinner';
    const assigned = RT.assigned.find(a => a.id === id);
    const req = assigned ? deriveAssigned(assigned) : CATALOG.find(r => r.id === id);
    if (!req) return `${backHead('Requirement', 'Not found')}<div class="state-demo"><div class="sd-t">Nothing here</div></div>`;

    const proof = PROOF[req.proof] || PROOF.check;
    const impact = IMPACT_LABEL[req.impact.kind === 'component' ? req.impact.comp : req.impact.kind];
    const done = assigned ? assigned.done : false;

    const actionBtn = assigned
      ? (done
        ? `<div class="day-done"><div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
           <div><div class="tt">Done. ${assigned.from} can see it.</div><div class="ts">Completed tonight.</div></div></div>`
        : `<button class="btn green" data-act="completeAssigned:${id}" data-then="requirement/${id}">${icon('check', 19)} Mark Done · coach sees it</button>`)
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
      <div class="who"><div class="av">M</div><div><div class="nm">${S.coach.name}</div><div class="rl">${assigned ? 'On this task' : 'On this requirement'}</div></div></div>
      <p>“${req.note}”</p>
    </div>

    <div style="height:18px"></div>
    ${actionBtn}
    <div style="height:10px"></div>
    `;
  },
  mount() { if (window.__act) window.__act.seeAssigned(); },
};
