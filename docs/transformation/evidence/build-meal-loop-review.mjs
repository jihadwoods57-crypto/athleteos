// Builds the meal-loop before/after artifact. Inlines the product's own typeface and the captured
// screenshots as data URIs — the Artifact CSP blocks every external host.
import { readFileSync, writeFileSync } from 'node:fs';

const SP = 'C:/Users/ADMINI~1/AppData/Local/Temp/claude/c--Users-Administrator-Downloads-athleteos/e89ca069-81fe-4098-a63f-78875c7e7c02/scratchpad/';
const REPO = 'C:/Users/Administrator/Downloads/athleteos/';
const img = JSON.parse(readFileSync(SP + 'imgs2.json', 'utf8'));
const face = readFileSync(REPO + 'proto/redesign-2026-07/fonts/PlusJakartaSans-800ExtraBold.ttf').toString('base64');

const shot = (src, tag, cap) => `
  <figure class="shot ${tag === 'Before' ? 'was' : 'now'}">
    <span class="tag">${tag}</span>
    <img loading="lazy" src="${src}" alt="${cap}">
    <figcaption>${cap}</figcaption>
  </figure>`;

const html = `<title>OnStandard — The meal loop, rebuilt</title>
<style>
@font-face{font-family:'Jakarta';src:url(data:font/ttf;base64,${face}) format('truetype');font-weight:800;font-display:swap}

:root{
  --ink:#080D14; --surface:#101823; --raise:#16202C;
  --line:rgba(148,176,224,.13); --line-soft:rgba(148,176,224,.06);
  --text:#E9EFF6; --muted:#7F93AA;
  --wait:#F5A524;   /* the product's own "due / waiting" amber = BEFORE */
  --done:#34D399;   /* the product's own "on standard" green = AFTER   */
  --shadow:0 20px 48px rgba(0,0,0,.5);
  --display:'Jakarta',ui-sans-serif,system-ui,sans-serif;
  --body:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
  --data:ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme:light){
  :root{ --ink:#F4F7FA; --surface:#FFF; --raise:#EDF2F7;
    --line:rgba(10,17,25,.13); --line-soft:rgba(10,17,25,.06);
    --text:#0A1119; --muted:#54657A; --wait:#B45309; --done:#0F7A54;
    --shadow:0 12px 32px rgba(10,17,25,.10); }
}
:root[data-theme="light"]{ --ink:#F4F7FA; --surface:#FFF; --raise:#EDF2F7;
  --line:rgba(10,17,25,.13); --line-soft:rgba(10,17,25,.06);
  --text:#0A1119; --muted:#54657A; --wait:#B45309; --done:#0F7A54;
  --shadow:0 12px 32px rgba(10,17,25,.10); }
:root[data-theme="dark"]{ --ink:#080D14; --surface:#101823; --raise:#16202C;
  --line:rgba(148,176,224,.13); --line-soft:rgba(148,176,224,.06);
  --text:#E9EFF6; --muted:#7F93AA; --wait:#F5A524; --done:#34D399;
  --shadow:0 20px 48px rgba(0,0,0,.5); }

*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--text);font-family:var(--body);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:60px 24px 100px;display:flex;flex-direction:column;gap:72px}
h1,h2,h3{font-family:var(--display);font-weight:800;letter-spacing:-.025em;text-wrap:balance;margin:0}
p{margin:0}
:focus-visible{outline:2px solid var(--done);outline-offset:3px;border-radius:6px}
.eyebrow{font-family:var(--data);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}

/* masthead */
.mast{display:flex;flex-direction:column;gap:18px}
.mast h1{font-size:clamp(32px,5.4vw,56px);line-height:1.03}
.lede{font-size:clamp(16px,1.9vw,19px);color:var(--muted);max-width:64ch}
.lede b{color:var(--text);font-weight:600}

/* the wait, as a figure */
.wait{display:grid;grid-template-columns:1fr auto 1fr;gap:24px;align-items:center;
  border:1px solid var(--line);border-radius:18px;background:var(--surface);padding:34px 30px;box-shadow:var(--shadow)}
.wait .side{display:flex;flex-direction:column;gap:6px}
.wait .n{font-family:var(--display);font-weight:800;line-height:.9;letter-spacing:-.04em;font-size:clamp(46px,8vw,80px)}
.wait .was .n{color:var(--wait)}
.wait .now .n{color:var(--done)}
.wait .k{font-family:var(--data);font-size:12px;color:var(--muted)}
.wait .arrow{font-size:30px;color:var(--muted);font-family:var(--display)}
.wait .now{text-align:right;align-items:flex-end}

/* chapters */
.chapter{display:flex;flex-direction:column;gap:22px}
.chead{display:flex;gap:18px;align-items:baseline}
.cnum{font-family:var(--display);font-weight:800;font-size:15px;color:var(--ink);background:var(--done);
  min-width:30px;height:30px;border-radius:50%;display:grid;place-items:center;flex:none;align-self:center}
.ctitle h2{font-size:clamp(22px,3vw,30px);line-height:1.15}
.ctitle .sub{color:var(--muted);margin-top:4px;max-width:62ch}
.ctitle .sub b{color:var(--text);font-weight:600}

.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px}
.shot{margin:0;position:relative;display:flex;flex-direction:column;gap:9px}
.shot img{width:100%;display:block;border-radius:13px;border:1px solid var(--line);box-shadow:var(--shadow);background:#000}
.shot .tag{position:absolute;top:11px;left:11px;z-index:1;font-family:var(--data);font-size:10px;font-weight:700;
  letter-spacing:.09em;text-transform:uppercase;padding:3px 8px;border-radius:4px}
.shot.was .tag{background:var(--wait);color:#1B1204}
.shot.now .tag{background:var(--done);color:#04211D}
.shot figcaption{font-size:13px;color:var(--muted);line-height:1.45}

.note{border-left:3px solid var(--done);padding:2px 0 2px 16px;color:var(--text);max-width:62ch}
.note.warn{border-left-color:var(--wait)}

/* findings */
.finds{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}
.find{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--wait);border-radius:13px;padding:20px}
.find h3{font-size:16px;margin-bottom:7px}
.find p{font-size:14.5px;color:var(--muted)}
.find p b{color:var(--text);font-weight:600}

/* table */
.metrics{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface)}
.metrics .cap{padding:18px 22px;border-bottom:1px solid var(--line-soft)}
.metrics .cap h2{font-size:19px}
.metrics .cap p{color:var(--muted);font-size:14px;margin-top:4px}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14.5px;min-width:480px}
th,td{text-align:left;padding:12px 22px;border-bottom:1px solid var(--line-soft)}
th{font-family:var(--data);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
tbody tr:last-child td{border-bottom:none}
td.n{font-family:var(--data);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
td.n.was{color:var(--wait)} td.n.now{color:var(--done);font-weight:600}

footer{color:var(--muted);font-family:var(--data);font-size:12px;border-top:1px solid var(--line);padding-top:20px}
@media (max-width:720px){ .wait{grid-template-columns:1fr;text-align:left} .wait .now{text-align:left;align-items:flex-start} .wait .arrow{transform:rotate(90deg)} }
</style>

<div class="wrap">

  <header class="mast">
    <p class="eyebrow">OnStandard · Meal loop &amp; thread · 28 July 2026</p>
    <h1>The athlete used to wait<br>for permission to leave.</h1>
    <p class="lede">Logging a meal meant photographing it, then standing there while a vision model
      read the plate. Nothing counted until it finished. The whole product is built on logging every
      meal, every day, and the loop asked for <b>twenty seconds of held attention</b> each time.
      Four changes later, it asks for about two.</p>
  </header>

  <section class="wait" aria-label="Attention required to log a meal, before and after">
    <div class="side was">
      <span class="n">~20s</span>
      <span class="k">Before · watching a scan bar</span>
    </div>
    <div class="arrow" aria-hidden="true">→</div>
    <div class="side now">
      <span class="n">~2s</span>
      <span class="k">After · tap, done, walk away</span>
    </div>
  </section>

  <section class="chapter">
    <div class="chead">
      <span class="cnum">1</span>
      <div class="ctitle">
        <h2>Log it now. Read it after.</h2>
        <p class="sub">The meal commits the instant they tap. The AI's read arrives in the thread a
          few seconds later, like a message — and the athlete is already gone.</p>
      </div>
    </div>
    <div class="shots">
      ${shot(img.beforeCamera, 'Before', '"Analyze meal" — the ask was for a wait, and nothing counted until it returned.')}
      ${shot(img.afterCamera, 'After', '"Log it." It counts on tap; the read follows on its own.')}
      ${shot(img.beforeAnalyzing, 'Before', 'The interstitial, mid-read. Its only job was to hold you here.')}
      ${shot(img.afterPending, 'After', 'Logged and counting. Dashes, not zeros — an absence is not a measurement.')}
    </div>
    <p class="note">This is honest by construction. A meal whose read is still in flight earns
      photo and timing credit only — exactly what a manually-logged meal has always scored. The
      scoring engine was not changed, and a test asserts a pending meal's score is byte-identical to
      a manual one.</p>
  </section>

  <section class="chapter">
    <div class="chead">
      <span class="cnum">2</span>
      <div class="ctitle">
        <h2>The questions moved into the conversation.</h2>
        <p class="sub">When the model can't see something — rice under the chicken, oil in the pan —
          it asks. That used to be another screen standing between the athlete and their day.</p>
      </div>
    </div>
    <div class="shots">
      ${shot(img.beforeQuestions, 'Before', 'A screen of its own, between the athlete and their day.')}
      ${shot(img.afterQuestions, 'After', 'Asked in the thread. The meal is already logged; answer now, later, or never.')}
      ${shot(img.afterFailed, 'After', 'And when the read fails, it says so — the meal stays logged, because the photo is the proof.')}
    </div>
    <p class="note" style="border-left-color:var(--muted)">Both old screens still exist and still
      work — they are simply no longer in the path. A deep link from an old notification lands
      exactly where it used to.</p>
    <p class="note warn">The old flow also lost work. The photo lived only in session storage, so
      force-quitting mid-analysis lost it. The upload had no retry. An offline log lost its database
      row — and its thread — permanently. One durable queue now carries the whole job through all
      three.</p>
  </section>

  <section class="chapter">
    <div class="chead">
      <span class="cnum">3</span>
      <div class="ctitle">
        <h2>The AI started remembering.</h2>
        <p class="sub">The memory table has been in production since day one with
          <b>nothing ever reading it</b> — the code that used it lived in an app that was deleted.
          An athlete could correct the same mistake every morning, forever.</p>
      </div>
    </div>
    <div class="shots">
      ${shot(img.memConfirm, 'After', 'An inferred dislike is never assumed. It waits for a tap.')}
    </div>
    <p class="note">The most valuable thing it learns is not a preference — it is calibration.
      "Portion was double", repeated, becomes <b>their servings usually run larger than they look
      (seen 4×) — lean up when portion size is ambiguous</b>. That corrects a systematic bias rather
      than recording a taste. It is phrased as guidance, never as a number, and it is deliberately
      hidden from coaches: "he underestimates portions" reads as a judgement about honesty, when it
      is a fact about the camera.</p>
  </section>

  <section class="chapter">
    <div class="chead">
      <span class="cnum">4</span>
      <div class="ctitle">
        <h2>The coach became visible. The AI learned its limits.</h2>
        <p class="sub">A coach watching sixty athletes cannot write sixty comments — so most meals
          got nothing, and to the athlete "nothing" is indistinguishable from "not seen".</p>
      </div>
    </div>
    <div class="shots">
      ${shot(img.coachReactions, 'After', 'Two seconds instead of a paragraph. Tapping again removes it, so a mis-tap is undoable.')}
    </div>
    <p class="note warn">And the AI now declines. Asked about an injury, making weight, or anything
      medical, it says <b>"that one's for a person, not me"</b>, tells the athlete it has flagged it,
      and notifies their coach. The real defect was structural: the model was only ever offered a
      "reply" tool, and a forced reply tool <b>cannot</b> decline. It had no way to say no.</p>
  </section>

  <section>
    <p class="eyebrow" style="margin-bottom:14px">Found by doing the work, not by planning it</p>
    <div class="finds">
      <div class="find">
        <h3>The public key could write to 52 tables</h3>
        <p>Applying a migration surfaced a disagreement between production and a clean database.
          The anonymous key — the one shipped inside the app — held insert, update and delete on
          <b>days, meals and profiles</b>, from Supabase's own project defaults. Proved not
          exploitable first (row-level security refused the write), then closed anyway: it was one
          bad policy away from being a real door.</p>
      </div>
      <div class="find">
        <h3>Two bugs the tests caught, not review</h3>
        <p>A parity test failed on its first run — the new code lowercased food names where the
          original preserved what the athlete typed. And a stored value could be an object, which
          would have put the literal text <b>"[object Object]"</b> into a prompt as a fact about
          someone.</p>
      </div>
      <div class="find">
        <h3>The type checker lied</h3>
        <p>It reported a file clean while it contained a genuine syntax error, because it was
          serving a stale cache. Only the deployment bundler caught it. That moved "add type
          checking to CI" from a nice-to-have to a real risk — <b>wired up naively, it would give
          false assurance.</b></p>
      </div>
    </div>
  </section>

  <section class="metrics">
    <div class="cap">
      <h2>Measured, not asserted</h2>
      <p>Every screenshot is the real app rendered from seeded evidence against a stubbed backend.
        No production data, and no number in these images was drawn by the capture script.</p>
    </div>
    <div class="scroll">
      <table>
        <thead><tr><th>Measure</th><th style="text-align:right">Before</th><th style="text-align:right">After</th></tr></thead>
        <tbody>
          <tr><td>Attention to log one meal</td><td class="n was">~20s</td><td class="n now">~2s</td></tr>
          <tr><td>Screens between photo and done</td><td class="n was">2–3</td><td class="n now">0</td></tr>
          <tr><td>Photo survives a force-quit mid-analysis</td><td class="n was">no</td><td class="n now">yes</td></tr>
          <tr><td>Offline log keeps its thread</td><td class="n was">no</td><td class="n now">yes</td></tr>
          <tr><td>Edge functions reading athlete memory</td><td class="n was">0</td><td class="n now">2</td></tr>
          <tr><td>AI can decline a medical question</td><td class="n was">no</td><td class="n now">yes</td></tr>
          <tr><td>Enforced ceiling on AI spend</td><td class="n was">none</td><td class="n now">$50/day</td></tr>
          <tr><td>Automated tests</td><td class="n was">2,571</td><td class="n now">2,638</td></tr>
          <tr><td>Authorization checks</td><td class="n was">417 / 419</td><td class="n now">419 / 419</td></tr>
          <tr><td>New database migrations required</td><td class="n was">—</td><td class="n now">0</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <p class="eyebrow" style="margin-bottom:12px">Where it stands</p>
    <p class="note">Everything above is on a branch and verified. The two AI features — memory and
      the daily follow-up — are behind flags that are currently <b>off</b>: enable per athlete, then
      one team, then everyone, watching spend and the flag-rate counters. Rollback for those is a
      flag flip; the logging change is a client redeploy.</p>
  </section>

  <footer>
    Rendered from the shipped WebView app against seeded fixtures and a stubbed backend.
    Typeface is the product's own Plus Jakarta Sans. Colours are the product's own: amber is what it
    already uses for "due", green for "on standard".
  </footer>
</div>`;

writeFileSync(SP + 'meal-loop.html', html);
console.log('written', Math.round(html.length / 1024) + 'kb');
