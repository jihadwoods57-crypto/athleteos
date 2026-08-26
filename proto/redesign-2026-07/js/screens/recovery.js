import { S, RT, act, tier, checkinProjection, checkinBestProjection, liveWeightPct } from '../state.js';
import { DAY } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { recoveryCoachMessage } from '../recovery-intel.js';
import { scoreMoveDial, playScoreMove } from '../score-move.js';
import * as roles from '../roles.js';

/* The move this screen is allowed to show.
 *
 * RT.lastMove is whatever moved the score MOST RECENTLY, from any source. This screen is also
 * reachable without submitting anything — exec.js routes the finished Recovery row straight here —
 * so opening the app hours later and tapping it used to print the last MEAL's points under the
 * heading "Check-In Submitted". The check-in would be credited with points it did not earn, on the
 * one screen whose whole job is to say what the check-in was worth. It shows a move only when the
 * move is the check-in's own. */
function checkinMove() {
  const mv = RT.lastMove;
  if (!mv || mv.what !== 'Recovery Check-In') return null;
  return mv;
}

/** True when nothing before today has ever been scored — this is the athlete's first check-in. */
function firstEver() {
  const hist = DAY.scoreHistory || [];
  return !hist.some((h) => h && h.date && h.date < String(DAY.date));
}

export const recoveryConfirm = {
  tab: 'home',
  hideTabs: true,
  transient: true, // post-submit interstitial — Done returns to the pre-check-in origin
  render() {
    const mv = checkinMove();
    const toTier = tier(mv ? mv.to : S.score);
    const promoted = !!mv && tier(mv.from).name !== toTier.name;
    return `
    <div class="confirm-wrap">
      ${/* Composed from tokens, not frozen hexes. `#7e22ce` was the DARK --purple-deep written
            literally, and on light theme that value is what --purple-bright becomes, so the
            gradient collapsed toward a single flat purple on exactly the theme where it needed
            the most separation. Pair --purple-bright with --purple-deep (never -bright with a
            literal), and compose the halo from --purple-rgb. */''}
      <div class="big-check"><div class="core" style="background:linear-gradient(155deg, var(--purple-bright), var(--purple-deep)); color:#fff; box-shadow: 0 0 44px rgba(var(--purple-rgb),0.55), 0 10px 34px rgba(0,0,0,0.4)">${icon('moonStar', 32)}</div></div>
      <div class="confirm-title">Check-In Submitted</div>
      <div class="confirm-sub">Recovery refreshed · ${S.coach.hasCoach ? `${esc(S.coach.nameMid)} can see your readiness` : 'counted toward tomorrow'}</div>

      ${/* The move, as the score's own dial: the points just filed sweep in from where the score
            already was, the numeral counts through them, and the tier chip flips at the frame the
            arc crosses the line. Nothing is shown at all when this visit is not the submit itself
            (see checkinMove above) — a screen with no move to report says so. */''}
      ${mv ? `${scoreMoveDial({ from: mv.from, to: mv.to, uid: 'rc' })}
      <div class="confirm-sub">Daily Score · +${mv.gain} pts</div>`
      : `<div class="confirm-sub">Recovery is in for tonight. Your score already counts it.</div>`}
      ${mv && firstEver() ? `<div class="confirm-sub">Your first check-in. Recovery is ${liveWeightPct('checkin') + liveWeightPct('recovery')}% of the score, and it is the part only you can report.</div>` : ''}

      ${(() => {
        // The AI Nutritionist reads the answers just submitted and coaches — derived from
        // DAY.ci (recovery-intel.js), so the points never arrive without a voice behind them.
        const msg = recoveryCoachMessage({
          ci: DAY.ci, ciConfig: DAY.ciConfig,
          hasCoach: S.coach.hasCoach, coachName: S.coach.nameMid,
        });
        return msg ? `
      <div class="sidebox" style="margin-top:18px; text-align:left; width:100%">
        <div class="req-icon p" style="width:38px;height:38px">${icon('message', 17)}</div>
        <div><div class="tt">AI Nutritionist</div>
        <div class="ts">${esc(msg)}</div></div>
      </div>` : '';
      })()}
      ${/* The standalone promotion chip that sat here is gone: the dial carries a tier chip of its
            own now, and it flips to this exact tier mid-sweep, so a second chip printing the same
            two words directly underneath read as the app saying it twice. What survives is the
            line the chip could not say — which day is about to lock, and when. */''}
      ${promoted && S.streakDays > 0 ? `<div class="confirm-sub">You finished the day on standard. Day ${S.streakDays} locks at midnight.</div>` : ''}

      ${S.nextMove ? '' : `
      <div style="height:20px"></div>
      <div class="day-done" style="width:100%; text-align:left">
        <div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
        <div><div class="tt">Every requirement is in.</div>
        <div class="ts">This is what OnStandard looks like. Same again tomorrow.</div></div>
      </div>`}
    </div>
    <div style="height:22px"></div>
    <button class="btn primary" data-back="home">Done</button>
    <div style="height:10px"></div>
    <button class="btn ghost sm" data-go="progress">See the week</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    /* The nine lines of hand-rolled count-up that lived here — the same nine the meal thread had a
       copy of — are now score-move.js, which also gives this screen the one thing it never had: a
       haptic. Filing the check-in is one of the four scored parts and it landed in total silence,
       while logging a meal buzzed. Keyed on the move itself, so a repaint paints the outcome
       instead of replaying the ceremony. */
    const mv = checkinMove();
    if (mv) playScoreMove(root, { key: `move:checkin:${DAY.date}:${mv.from}-${mv.to}`, from: mv.from, to: mv.to });
  },
};

export default {
  tab: 'home',
  transient: true, // form screen: submitting hands off to the confirm — never a back-target
  render() {
    if (RT.recoveryDone) {
      return `
      ${backHead('Recovery Check-In', 'Done for tonight')}
      <div class="state-demo" style="border-style:solid; border-color:var(--green-border)">
        <div class="sd-ic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 24)}</div>
        <div class="sd-t">Submitted tonight</div>
        <div class="sd-s">Recovery counted · scored ${S.components.now.recovery}. ${S.coach.hasCoach ? `${esc(S.coach.name)} can see your readiness before tomorrow's practice.` : `It feeds tomorrow's readiness.`}</div>
      </div>`;
    }
    const R = S.recovery;
    const P = checkinProjection();          // projected score with the answers currently selected
    const best = checkinBestProjection();   // ceiling — SAME CI_BEST math the Score Breakdown prints
    return `
    ${backHead('Recovery Check-In', 'Before bed · Takes 20 seconds')}

    ${/* The rationale paragraph that sat here is gone: the backHead already names the screen,
          and the projection sidebox below carries the score stakes with real numbers. */''}
    <section class="card" style="padding: 4px 18px 8px">
      ${R.fields.map(f => `
        <div class="rec-field" data-ci-key="${f.key}">
          <div class="rec-top">
            <span class="rec-name">${f.k}</span>
            <span class="rec-ends">${f.lo} → ${f.hi}</span>
          </div>
          <div class="chips5" data-toggle-group role="radiogroup" aria-label="${f.k}">
            ${[1,2,3,4,5].map(n => `<div class="c5 ${n === f.val ? 'on' : ''}" data-n="${n}" role="radio" aria-checked="${n === f.val}" aria-label="${f.k}: ${n} of 5">${n}</div>`).join('')}
          </div>
        </div>`).join('')}
    </section>
    <div style="font-size:var(--t-sm);font-weight:600;color:var(--text-3);margin-top:8px;padding:0 2px;line-height:1.5">Answers are self-reported. What you enter here becomes your Recovery score, so keep it honest.</div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon p" style="width:38px;height:38px">${icon('moonStar', 18)}</div>
      ${/* No projected number until every question is answered. The projection merges the
            athlete's answers over DAY.ci, so projecting from an empty form was projecting from
            defaults nobody entered — the same fabrication the chips themselves used to carry.
            The ceiling ("Earn up to") is real either way: it does not depend on the answers. */''}
      <div><div class="tt" id="rec-gain">${best.gain > 0
        ? `Current: ${S.score} · Earn up to +${best.gain}<span data-proj-wrap hidden> · Projected: <span data-proj>${P.to}</span></span>`
        : 'Refreshes your Recovery score tonight'}</div>
      <div class="ts">Same math as your Score Breakdown: your answers set the exact number. ${S.coach.hasCoach ? `${esc(S.coach.name)} sees your readiness before tomorrow's practice.` : 'Honest answers are the whole point.'}</div></div>
    </div>

    <div style="height:18px"></div>
    ${/* Gated until every question is answered. An unanswered question used to submit a
          flattering default (see S.recovery in state.js), so the gate is what makes the
          check-in the athlete's own words rather than the app's guess about them. */''}
    <button class="btn recovery" id="rec-submit" disabled>
      ${icon('check', 19)} <span id="rec-submit-label">Answer all ${R.fields.length} to submit</span>
    </button>

    <!-- Wearable connect: hidden unless Apple Health / Health Connect is actually available on
         this build (probed in mount): device sleep/HRV is shown for CONTEXT on #devices and
         never changes the score. Keeps zero reachable "coming soon" until the module is wired. -->
    <div id="rec-connect" class="sidebox" data-go="devices" role="button" style="display:none;margin-top:14px;cursor:pointer">
      <div class="req-icon b" style="width:38px;height:38px">${icon('moonStar', 17)}</div>
      <div><div class="tt">Connect Apple Health</div><div class="ts">Bring last night's sleep, HRV &amp; resting HR in for context</div></div>
    </div>
    <div style="height:8px"></div>
    `;
  },
  mount(root) {
    // The chips are the real scoring inputs: 1–5 selection maps to the engine's 0–10 scale
    // as n*2. Selections update live; submit sends the ACTUAL answers to the engine.
    const answers = {};
    const fields = root.querySelectorAll('[data-ci-key]');
    const total = fields.length;
    const submit = root.querySelector('#rec-submit');
    const submitLabel = root.querySelector('#rec-submit-label');
    const projWrap = root.querySelector('[data-proj-wrap]');
    // The gate. Every question has to be the athlete's own answer before this can be filed:
    // a skipped question used to submit a flattering default in its place.
    const refreshGate = () => {
      const done = Object.keys(answers).length;
      const ready = done >= total;
      if (submit) submit.disabled = !ready;
      if (submitLabel) submitLabel.textContent = ready ? 'Submit Check-In' : `${done} of ${total} answered`;
      // The projection is only honest once it is projecting from real answers.
      if (projWrap) projWrap.hidden = !ready;
      if (ready) {
        const proj = root.querySelector('[data-proj]');
        if (proj) proj.textContent = String(checkinProjection(answers).to);
      }
    };
    fields.forEach(field => {
      const key = field.getAttribute('data-ci-key');
      const chips = field.querySelectorAll('.c5');
      chips.forEach(ch => {
        const n = +ch.getAttribute('data-n');
        if (ch.classList.contains('on')) answers[key] = n * 2;
        ch.addEventListener('click', () => {
          chips.forEach(x => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
          ch.classList.add('on');
          ch.setAttribute('aria-checked', 'true');
          answers[key] = n * 2;
          refreshGate();
        });
      });
    });
    refreshGate();
    if (submit) submit.addEventListener('click', () => {
      // Belt and braces: the button is disabled, but a check-in is scored and seen by a coach,
      // so it does not get filed on a partial answer set under any circumstances.
      if (Object.keys(answers).length < total) return;
      act.submitRecovery(answers);
      window.__go('recovery-confirm');
    });
    // Reveal the wearable-connect row only if Apple Health / Health Connect is really available
    // on this build (false in browser/preview and until the founder wires the module).
    roles.healthAvailable().then((ok) => {
      if (!ok) return;
      const row = root.querySelector('#rec-connect');
      if (row) row.style.display = '';
    }).catch(() => { /* no bridge — stays hidden */ });
  },
};
