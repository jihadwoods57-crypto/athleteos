/* Send feedback — the front door to a support pipeline that already existed.
 *
 * 0125 built support_tickets, support_ticket_events, a validated and rate-limited
 * create_support_ticket(), and a founder queue that orders safety first and masks minors' contact
 * details. Nothing ever called it. The only way an athlete or coach could say anything was the
 * mailto: link in Settings, so every piece of feedback landed in an inbox with no queue, no
 * categories and no history — while the queue sat empty and audited.
 *
 * This screen is that door. It writes nothing of its own: category, subject and body go straight to
 * the RPC, which owns validation (subject 3–200, body ≤4000), the rate limit (5/hour/user), and the
 * routing rule that a safety report becomes 'urgent' without the client being trusted to say so.
 *
 * Four decisions worth keeping:
 *
 *   1. SAFETY KEEPS ITS OWN LANE. 0125 deliberately routes it to a separate urgent queue. A generic
 *      "feedback" box that swallowed a safeguarding disclosure into a list of feature ideas would be
 *      a real harm, so it is a distinct, visually separated choice with its own copy.
 *   2. BUGS CARRY THEIR OWN CONTEXT. Nobody can be expected to report which build they are on. The
 *      app knows, so it appends it. A bug report you must reply to just to ask "which screen?" costs
 *      more than it saves.
 *   3. NO PROMISES WE HAVEN'T STAFFED. The confirmation says we read every one and will reply if it
 *      needs one. Not "within 24 hours".
 *   4. 'idea' DEGRADES INSTEAD OF FAILING. Until 0162 is applied, the server rejects that category.
 *      Rather than show an athlete an error for helping, the send falls back to 'question' with the
 *      subject labelled — see sendTicket().
 */
import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { track, EVENTS } from '../analytics.js';
import { buzz } from '../motion.js';

/* The picker. `cat` is the server's category; everything else is how a person would say it.
   Order is deliberate: the two things people actually arrive to do first, then account matters,
   then safety last and visually apart — a list that opens with a safeguarding prompt reads as an
   app that expects trouble. */
const KINDS = [
  // 'flash' over 'wifiOff': the latter is the app's OFFLINE mark and means something specific
  // elsewhere. Reusing it here would tell someone with a broken score that they have no signal.
  { cat: 'bug',      ic: 'flash',     t: "Something's broken",  s: 'A screen, a number or a photo that went wrong' },
  { cat: 'idea',     ic: 'sparkle',   t: 'I have an idea',      s: 'Something that would make this better for you' },
  { cat: 'question', ic: 'message',   t: 'A question',          s: 'How something works, or what a number means' },
  { cat: 'billing',  ic: 'clipboard', t: 'Billing or my plan',  s: 'Payments, invoices, seats, cancelling' },
];
const SAFETY = { cat: 'safety', ic: 'shield', t: 'A safety concern', s: 'Something about a person’s wellbeing. Goes straight to the top of the queue.' };

const LABEL = Object.fromEntries([...KINDS, SAFETY].map((k) => [k.cat, k.t]));

/* Screen state. Module-level so a repaint (the router rebuilds #view on every render) keeps the
   athlete's typing — losing a half-written bug report to an async repaint would be its own bug. */
const F = { cat: null, subject: '', body: '', sending: false, sent: null, error: null, from: 'settings' };

function reset(from, cat) {
  F.cat = cat || null; F.subject = ''; F.body = '';
  F.sending = false; F.sent = null; F.error = null; F.from = from;
}

/* One-shot: set when a caller opened this screen deliberately WITH a category (the failed-analysis
   button), so the arrival reset in mount() doesn't immediately throw that category away. */
let PRIMED = false;

/** Open with a category already chosen, from somewhere that knows what kind of thing this is. */
export function openFeedback(from = 'settings', cat = null) {
  reset(from, cat);
  PRIMED = true;
  track(EVENTS.FEEDBACK_OPENED, { from });
}

/* What the athlete cannot be expected to describe, and we already know. Kept to counts and enums —
   no free text, no identifiers beyond the role — because it rides in a body a human will read and
   there is no reason for it to carry more than it needs. */
function bugContext() {
  const bits = [
    ['role', RT.authRole || 'unknown'],
    ['app', (typeof window !== 'undefined' && window.__APP_VERSION) || 'dev'],
    ['proto', (typeof window !== 'undefined' && window.__PROTO_VERSION) || 'dev'],
    ['screen', String((typeof location !== 'undefined' && location.hash) || '').replace(/^#/, '') || 'unknown'],
    ['sync', S.syncIssue || 'ok'],
    ['online', typeof navigator === 'undefined' ? 'unknown' : String(navigator.onLine !== false)],
  ];
  return bits.map(([k, v]) => `${k}: ${v}`).join('\n');
}

/**
 * Create the ticket.
 *
 * The 'idea' fallback: 0162 adds that category to both the table constraint and the RPC's own
 * guard, but a build can reach a database where it has not been applied yet. The server answers
 * with 'invalid category', and the honest thing to do with someone who took the time to send an
 * idea is to file it, not to show them a red error. So it retries once as 'question' with the
 * subject labelled, which lands in the same queue and stays obvious to whoever reads it.
 */
async function sendTicket(cat, subject, body) {
  const roles = await import('../roles.js');
  try {
    return await roles.createSupportTicket(cat, subject, body);
  } catch (e) {
    const msg = String((e && e.message) || e).toLowerCase();
    if (cat === 'idea' && msg.includes('invalid category')) {
      return await roles.createSupportTicket('question', `[Idea] ${subject}`.slice(0, 200), body);
    }
    throw e;
  }
}

export const feedback = {
  tab: 'profile',
  hideTabs: true,

  render() {
    /* Arrival detection, and it has to happen HERE rather than in mount(): the router runs render()
       first and mount() second, so resetting in mount left one painted frame of whatever the last
       visit was — someone returning to report a second thing saw the old confirmation screen.
       When render() runs, the PREVIOUS screen is still in the DOM, so the absence of this screen's
       own root is a reliable "we are coming from somewhere else". A repaint (every keystroke, every
       send) keeps #fb-root present, so state and half-written text survive those untouched. */
    if (typeof document !== 'undefined' && !document.querySelector('#fb-root') && !PRIMED) {
      reset('settings', null);
      track(EVENTS.FEEDBACK_OPENED, { from: 'settings' });
    }
    PRIMED = false;

    if (F.sent) {
      return `<div id="fb-root">${backHead('Sent', LABEL[F.sent] || 'Thank you', 'settings')}
      <section class="card" style="padding:22px 18px;text-align:center;margin-top:14px">
        <div class="req-icon g" style="width:52px;height:52px;margin:0 auto 14px">${icon('check', 25)}</div>
        <div style="font-size:18px;font-weight:800;letter-spacing:var(--title-tight)">That's with us.</div>
        <div style="font-size:13.5px;font-weight:600;color:var(--text-2);line-height:1.55;margin-top:8px">
          We read every one. You'll hear back if it needs a reply.
        </div>
      </section>
      <div style="height:14px"></div>
      <button class="btn ghost sm" style="width:100%" data-go="settings">Done</button></div>`;
    }

    // Step 1 — what kind of thing is this.
    if (!F.cat) {
      const row = (k) => `
        <div class="lrow" data-fb-kind="${k.cat}" role="button" tabindex="0">
          <div class="lic">${icon(k.ic, 16)}</div>
          <div class="lm"><div class="lt">${esc(k.t)}</div><div class="ls" style="white-space:normal;line-height:1.45">${esc(k.s)}</div></div>
          ${icon('chevron', 16, 'style="color:var(--text-3)"')}
        </div>`;
      return `<div id="fb-root">${backHead('Send feedback', 'We read all of it', 'settings')}
      <section class="card" style="padding:6px 16px;margin-top:14px">${KINDS.map(row).join('')}</section>
      <div class="eyebrow" style="margin-top:18px">Urgent</div>
      <section class="card" style="padding:6px 16px;border-color:var(--red-border)">
        <div class="lrow" data-fb-kind="safety" role="button" tabindex="0">
          <div class="lic" style="color:var(--red-bright)">${icon(SAFETY.ic, 16)}</div>
          <div class="lm"><div class="lt">${esc(SAFETY.t)}</div><div class="ls" style="white-space:normal;line-height:1.45">${esc(SAFETY.s)}</div></div>
          ${icon('chevron', 16, 'style="color:var(--text-3)"')}
        </div>
      </section>
      <div style="height:20px"></div></div>`;
    }

    // Step 2 — say it. The header's back must return to the PICKER, not to the route (which is this
    // same screen), so it carries its own id rather than data-back.
    const safety = F.cat === 'safety';
    const bug = F.cat === 'bug';
    return `<div id="fb-root"><div class="back-head">
      <div class="bk" id="fb-back" role="button" tabindex="0" aria-label="Back">${icon('back', 20)}</div>
      <div><div class="ht">${esc(LABEL[F.cat] || 'Send feedback')}</div>
      <div class="hs">${esc(safety ? 'Straight to the top of the queue' : 'As much or as little as you like')}</div></div>
    </div>
    <section class="card" style="padding:16px;margin-top:14px${safety ? ';border-color:var(--red-border)' : ''}">
      <label class="eyebrow" for="fb-subject" style="display:block">One line</label>
      <input class="ob-input" id="fb-subject" maxlength="200" style="margin-top:8px"
        placeholder="${esc(bug ? 'The score on Home showed 0' : safety ? 'What is happening' : 'What it is')}"
        value="${esc(F.subject)}" />
      <label class="eyebrow" for="fb-body" style="display:block;margin-top:16px">More, if it helps</label>
      <textarea class="ob-input" id="fb-body" maxlength="4000" rows="6" style="margin-top:8px;resize:vertical"
        placeholder="${esc(bug ? 'What you were doing when it happened.' : safety ? 'Anything you can tell us. A person reads this.' : 'Whatever you want us to know.')}">${esc(F.body)}</textarea>
      ${bug ? `<div style="font-size:11.5px;font-weight:600;color:var(--text-3);line-height:1.5;margin-top:10px">
        Your app version and the screen you were on are attached automatically — you don't have to describe them.
      </div>` : ''}
    </section>
    ${F.error ? `<div style="font-size:12.5px;font-weight:700;color:var(--red-bright);text-align:center;padding:12px 16px 0">${esc(F.error)}</div>` : ''}
    <div style="height:16px"></div>
    <button class="btn ${safety ? 'primary' : 'green'}" id="fb-send" style="width:100%"${F.sending ? ' disabled' : ''}>
      ${F.sending ? 'Sending…' : `${icon('check', 18)} Send`}
    </button>
    <div style="height:10px"></div>
    <button class="btn ghost sm" id="fb-other" style="width:100%">Pick a different kind</button>
    <div style="height:20px"></div></div>`;
  },

  mount(root) {
    // Kind picker. data-go can't serve here (it would need a route per category), so these are
    // wired directly; listeners die with the next paint like every other screen's.
    root.querySelectorAll('[data-fb-kind]').forEach((el) => {
      const pick = () => {
        F.cat = el.getAttribute('data-fb-kind');
        F.error = null;
        window.__render && window.__render();
      };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });

    /* Back to the picker, and "pick a different kind", both clear the category IN PLACE. Navigating
       to #feedback would be a same-route re-render with F.cat still set, so the screen would appear
       not to respond at all. Whatever they typed is kept: changing your mind about the label is not
       a reason to lose the sentence. */
    const toPicker = () => { F.cat = null; F.error = null; window.__render && window.__render(); };
    const back = root.querySelector('#fb-back');
    if (back) {
      back.addEventListener('click', toPicker);
      back.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toPicker(); } });
    }
    const other = root.querySelector('#fb-other');
    if (other) other.addEventListener('click', toPicker);

    // Keep typing across repaints. 'input' rather than 'change' so an async paint mid-sentence
    // cannot lose the tail of what someone wrote.
    const sub = root.querySelector('#fb-subject');
    const body = root.querySelector('#fb-body');
    if (sub) sub.addEventListener('input', () => { F.subject = sub.value; });
    if (body) body.addEventListener('input', () => { F.body = body.value; });

    const send = root.querySelector('#fb-send');
    if (send) send.addEventListener('click', async () => {
      if (F.sending) return;
      const subject = (F.subject || '').trim();
      // Mirror the server's own floor rather than inventing a rule: 0125 requires 3 characters.
      if (subject.length < 3) {
        F.error = 'Give it one line first — even a few words.';
        window.__render && window.__render();
        return;
      }
      F.sending = true; F.error = null;
      window.__render && window.__render();
      let bodyText = (F.body || '').trim();
      if (F.cat === 'bug') bodyText = `${bodyText}\n\n---\n${bugContext()}`.trim();
      try {
        await sendTicket(F.cat, subject, bodyText.slice(0, 4000));
        track(EVENTS.FEEDBACK_SENT, { category: F.cat });
        buzz('reveal');
        F.sent = F.cat; F.sending = false;
      } catch (e) {
        const msg = String((e && e.message) || e).toLowerCase();
        F.sending = false;
        F.error = msg.includes('rate limit')
          ? "That's a few in a row — give it an hour and send the rest."
          : msg.includes('not authenticated')
            ? 'Sign in first, then send this — it needs to reach your account.'
            : "That didn't send. Nothing was lost — try again, or email support@onstandard.app.";
      }
      window.__render && window.__render();
    });
  },
};
