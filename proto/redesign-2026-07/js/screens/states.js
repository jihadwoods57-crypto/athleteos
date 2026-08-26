import { icon } from '../icons.js';
import { backHead } from '../components.js';
import { TIERS, tierRange } from '../score-band.js';
import { deriveCommitment } from '../commitments.js';
import { commitmentCard } from './roll-call.js';

/* Verification-state specimens (0208). These are the most dispute-sensitive states in the
   product, and the amber near-collision between "left early" (evidence, counts) and
   "unverified" (a gap in evidence, doesn't count) happened precisely because no canonical
   reference existed. Fixed fixtures + a fixed clock so the gallery renders identically forever. */
const VC_NOW = '2026-07-22T10:00:00Z';
const VC_BASE = {
  instance_id: 'demo-vc', type: 'strength', title: 'Lift', asks_arrival: true,
  location_name: 'the facility', min_dwell_min: 45,
  respond_by_min: 315, starts_min: 285, occurs_on: '2026-07-22',
  starts_at: '2026-07-22T08:45:00Z', respond_by_at: '2026-07-22T09:15:00Z',
  arrive_by_at: '2026-07-22T09:50:00Z', timezone: 'America/New_York',
  acknowledged_at: '2026-07-22T08:48:00Z', status: 'arrived',
};
const vcDemo = (over) => commitmentCard(deriveCommitment({ ...VC_BASE, ...over }, VC_NOW));

/* Design-states gallery: every empty / loading / error / tier state in one place,
   so nothing ships as an afterthought. */
export default {
  hideTabs: true,
  render() {
    return `
    ${backHead('Design states', 'Empty · loading · error · tiers, all specified', 'profile')}

    <div class="eyebrow">Score tiers</div>
    <section class="card pad" style="display:flex;flex-wrap:wrap;gap:10px">
      ${TIERS.map((t, i) => `<span class="tier-chip ${t.cls}" style="margin:0">${t.name} · ${tierRange(i)}</span>`).reverse().join('')}
    </section>

    <div class="eyebrow">Empty states</div>
    <div class="state-demo">
      <div class="sd-ic">${icon('camera', 24)}</div>
      <div class="sd-t">No logs yet</div>
      <div class="sd-s">Your proof trail builds here as you log. Take a photo to begin today's standard.</div>
      <div class="sd-cta"><button class="btn green sm" style="width:auto;padding:0 22px" data-go="camera">Log a meal</button></div>
    </div>
    <div class="state-demo">
      <div class="sd-ic">${icon('key', 22)}</div>
      <div class="sd-t">No coach connected</div>
      <div class="sd-s">Your work counts more when someone you respect can see it. Enter a coach code to join a group.</div>
      <div class="sd-cta"><button class="btn ghost sm" style="width:auto;padding:0 22px" data-go="connect">Enter coach code</button></div>
    </div>
    <div class="state-demo">
      <div class="sd-ic">${icon('bars', 22)}</div>
      <div class="sd-t">Progress builds as you log</div>
      <div class="sd-s">After your first few days, trends, streaks, and patterns show up here.</div>
    </div>

    <div class="eyebrow">Loading states · branded, never a bare spinner</div>
    <section class="card pad">
      ${['Checking meal quality', 'Matching this meal to your plan', 'Updating your score', 'Syncing coach plan'].map(t => `
        <div style="display:flex;align-items:center;gap:12px;padding:9px 0">
          <div class="scanbox" style="width:26px;height:26px;border-radius:8px;flex:none"><div class="scanline" style="height:2px"></div></div>
          <span style="font-size:14px;font-weight:700">${t}<span class="dots"></span></span>
        </div>`).join('')}
    </section>

    <div class="eyebrow">Error states · what happened + what to do</div>
    <div class="state-demo err-box">
      <div class="sd-ic">${icon('camera', 22)}</div>
      <div class="sd-t">Your meal photo didn't upload</div>
      <div class="sd-s">Check your connection and try again. The photo is saved on your phone; nothing is lost.</div>
      <div class="sd-cta"><button class="btn ghost sm" style="width:auto;padding:0 22px" data-go="camera">Try again</button></div>
    </div>
    <div class="state-demo err-box">
      <div class="sd-ic">${icon('bolt', 22)}</div>
      <div class="sd-t">AI couldn't read this one</div>
      <div class="sd-s">Log it by hand with Search food, or retake it in better light. Your on-time credit still counts from the capture.</div>
    </div>
    <div class="state-demo">
      <div class="sd-ic">${icon('shield', 22)}</div>
      <div class="sd-t">Offline · saved on device</div>
      <div class="sd-s">Coach will see this when you're back online. Keep logging; nothing waits on the network.</div>
    </div>

    <div class="eyebrow">Verification states · evidence vs the absence of it</div>
    ${vcDemo({ arrived_at: '2026-07-22T09:43:00Z', presence: 'provisional' })}
    ${vcDemo({ arrived_at: '2026-07-22T09:43:00Z', presence: 'left_early', departed_at: '2026-07-22T09:52:00Z' })}
    ${vcDemo({ arrived_at: '2026-07-22T09:43:00Z', presence: 'left_early', departed_at: '2026-07-22T09:52:00Z', completed_at: '2026-07-22T09:58:00Z', status: 'completed' })}
    ${vcDemo({ status: 'unverified', unverified_reason: 'Location permission off' })}
    ${vcDemo({ acknowledged_at: null, status: 'pending' })}
    ${vcDemo({ acknowledged_at: null, status: 'excused', excused_reason: 'Family travel' })}
    ${vcDemo({ arrived_at: '2026-07-22T09:43:00Z', presence: 'confirmed', completed_at: '2026-07-22T09:59:00Z', status: 'completed' })}
    <div style="height:10px"></div>
    `;
  },
};
