// Builds the before/after design-review artifact. Inlines the product's own typeface and the
// captured screenshots as data URIs, because the Artifact CSP blocks every external host.
import { readFileSync, writeFileSync } from 'node:fs';

const SP = 'C:/Users/ADMINI~1/AppData/Local/Temp/claude/c--Users-Administrator-Downloads-athleteos/e89ca069-81fe-4098-a63f-78875c7e7c02/scratchpad/';
const REPO = 'C:/Users/Administrator/Downloads/athleteos/';
const img = JSON.parse(readFileSync(SP + 'imgs.json', 'utf8'));
const face = readFileSync(REPO + 'proto/redesign-2026-07/fonts/PlusJakartaSans-800ExtraBold.ttf').toString('base64');

const pair = (id, title, when, note, a, b) => `
<section class="pair" aria-labelledby="${id}">
  <div class="pair-head">
    <h3 id="${id}">${title}</h3>
    <p class="when">${when}</p>
  </div>
  <div class="shots">
    <figure><div class="tag was">Before</div><img src="${a}" alt="${title}, before the redesign"></figure>
    <figure><div class="tag now">After</div><img src="${b}" alt="${title}, after the redesign"></figure>
  </div>
  <p class="note">${note}</p>
</section>`;

const html = `<title>OnStandard — Athlete Home, redesigned</title>
<style>
@font-face{font-family:'Jakarta';src:url(data:font/ttf;base64,${face}) format('truetype');font-weight:800;font-display:swap}

:root{
  --ink:#0A0F16; --surface:#121A24; --raise:#18222F;
  --line:rgba(148,176,224,.14); --line-soft:rgba(148,176,224,.07);
  --text:#E9EFF6; --muted:#8496AC;
  --accent:#2DD4BF;          /* the teal midpoint of the product's own score sweep = "after" */
  --was:#E8A13C;             /* the product's own attention hue = "before" */
  --shadow:0 18px 44px rgba(0,0,0,.44);
  --display:'Jakarta',ui-sans-serif,system-ui,sans-serif;
  --body:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
  --data:ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme:light){
  :root{
    --ink:#F5F8FB; --surface:#FFFFFF; --raise:#EEF3F8;
    --line:rgba(12,19,27,.13); --line-soft:rgba(12,19,27,.07);
    --text:#0C131B; --muted:#566577;
    --accent:#0D9488; --was:#B45309;
    --shadow:0 10px 30px rgba(12,19,27,.10);
  }
}
:root[data-theme="light"]{
  --ink:#F5F8FB; --surface:#FFFFFF; --raise:#EEF3F8;
  --line:rgba(12,19,27,.13); --line-soft:rgba(12,19,27,.07);
  --text:#0C131B; --muted:#566577;
  --accent:#0D9488; --was:#B45309;
  --shadow:0 10px 30px rgba(12,19,27,.10);
}
:root[data-theme="dark"]{
  --ink:#0A0F16; --surface:#121A24; --raise:#18222F;
  --line:rgba(148,176,224,.14); --line-soft:rgba(148,176,224,.07);
  --text:#E9EFF6; --muted:#8496AC;
  --accent:#2DD4BF; --was:#E8A13C;
  --shadow:0 18px 44px rgba(0,0,0,.44);
}

*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--text);font-family:var(--body);
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:56px 24px 96px;display:flex;flex-direction:column;gap:64px}
h1,h2,h3{font-family:var(--display);font-weight:800;letter-spacing:-.025em;text-wrap:balance;margin:0}
p{margin:0}
a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}

.eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}

/* ---- masthead ---- */
.mast{display:flex;flex-direction:column;gap:18px}
.mast h1{font-size:clamp(34px,6vw,58px);line-height:1.02}
.mast .lede{font-size:clamp(16px,2vw,19px);color:var(--muted);max-width:62ch}
.mast .lede b{color:var(--text);font-weight:600}

/* ---- the specimen: the change, shown in the type itself ---- */
.specimen{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line-soft);
  border:1px solid var(--line);border-radius:16px;overflow:hidden}
.spec{background:var(--surface);padding:28px 24px 22px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.spec .n{font-family:var(--display);font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--text)}
.spec.was .n{font-size:31px;color:var(--muted)}
.spec.now .n{font-size:52px}
.spec .cap{font-family:var(--data);font-size:11.5px;color:var(--muted);margin-top:8px}
.spec .cap b{color:var(--text);font-weight:600}

/* ---- annotated evidence ---- */
.evidence{display:grid;grid-template-columns:441px 1fr;gap:36px;align-items:start}
.anno{position:relative;flex:none;width:390px;margin-left:51px}
.anno img{width:100%;display:block;border-radius:14px;border:1px solid var(--line);box-shadow:var(--shadow)}
.pin{position:absolute;left:-51px;display:flex;align-items:center;gap:9px;pointer-events:none}
.pin i{width:26px;height:26px;border-radius:50%;background:var(--was);color:#1B1204;
  font-family:var(--display);font-weight:800;font-size:13px;font-style:normal;
  display:grid;place-items:center;flex:none;box-shadow:0 3px 12px rgba(0,0,0,.4)}
.pin::after{content:"";width:16px;height:2px;background:var(--was);border-radius:2px}
.claims{display:flex;flex-direction:column;gap:20px}
.claims h2{font-size:clamp(22px,3vw,30px);line-height:1.15}
.claims p{color:var(--muted);max-width:56ch}
.claims p b{color:var(--text);font-weight:600}
.three{display:flex;flex-direction:column;gap:10px;margin-top:4px}
.three li{list-style:none;display:flex;gap:11px;align-items:baseline;font-family:var(--data);
  font-size:13px;color:var(--text);background:var(--raise);border:1px solid var(--line-soft);
  border-left:3px solid var(--was);border-radius:8px;padding:10px 13px}
.three li em{font-style:normal;color:var(--muted);flex:none}
.verdict{border-left:3px solid var(--accent);padding:2px 0 2px 16px;color:var(--text);font-size:17px;max-width:56ch}

/* ---- before / after pairs ---- */
.pair{display:flex;flex-direction:column;gap:18px}
.pair-head{display:flex;flex-direction:column;gap:4px}
.pair-head h3{font-size:20px}
.when{font-family:var(--data);font-size:12px;color:var(--muted)}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;max-width:820px}
.shots figure{margin:0;position:relative}
.shots img{width:100%;display:block;border-radius:14px;border:1px solid var(--line);box-shadow:var(--shadow)}
.tag{position:absolute;top:12px;left:12px;z-index:1;font-family:var(--data);font-size:10.5px;
  font-weight:700;letter-spacing:.09em;text-transform:uppercase;padding:4px 9px;border-radius:5px}
.tag.was{background:var(--was);color:#1B1204}
.tag.now{background:var(--accent);color:#04211D}
.note{color:var(--muted);max-width:62ch}
.note b{color:var(--text);font-weight:600}

/* ---- measured ---- */
.metrics{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface)}
.metrics .cap{padding:18px 22px;border-bottom:1px solid var(--line-soft)}
.metrics .cap h2{font-size:20px}
.metrics .cap p{color:var(--muted);font-size:14px;margin-top:4px}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14.5px;min-width:520px}
th,td{text-align:left;padding:13px 22px;border-bottom:1px solid var(--line-soft)}
th{font-family:var(--data);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
tbody tr:last-child td{border-bottom:none}
td.n{font-family:var(--data);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
td.n.was{color:var(--was)}
td.n.now{color:var(--accent);font-weight:600}
td:first-child{color:var(--text)}

/* ---- next ---- */
.next{display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--line);padding-top:28px}
.next h2{font-size:20px}
.next ul{margin:0;padding-left:20px;color:var(--muted);display:flex;flex-direction:column;gap:8px;max-width:62ch}
.next li b{color:var(--text);font-weight:600}
footer{color:var(--muted);font-family:var(--data);font-size:12px;border-top:1px solid var(--line);padding-top:20px}

@media (max-width:860px){
  .evidence{grid-template-columns:1fr}
  .anno{width:100%;max-width:390px;margin-left:0}
  .pin{left:8px}
  .pin::after{display:none}
  .specimen{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:no-preference){
  .pair img,.anno img{transition:transform .35s cubic-bezier(.16,1,.3,1)}
  .pair figure:hover img{transform:translateY(-3px)}
}
</style>

<div class="wrap">

  <header class="mast">
    <p class="eyebrow">OnStandard · Design review · 26 July 2026</p>
    <h1>The score is the product.<br>It wasn't behaving like it.</h1>
    <p class="lede">Athlete Home is the screen every athlete opens first. It was stating the same fact
      <b>three times above the fold</b> while the daily score — the number the whole product promises never
      lies — rendered at <b>31px inside a bordered card</b>, directly beneath a full-bleed amber button that
      visually outranked it.</p>
  </header>

  <section class="specimen" aria-label="The score numeral, before and after, at actual size">
    <div class="spec was"><span class="n">41</span>
      <p class="cap">Before · <b>31px</b>, inside a card</p></div>
    <div class="spec now"><span class="n">41</span>
      <p class="cap">After · <b>52px</b>, on the canvas</p></div>
  </section>

  <section class="evidence">
    <div class="anno">
      <img src="${img.beforeMorning}" alt="Athlete Home before the redesign, with three markers showing the same fact repeated">
      <div class="pin" style="top:14.6%"><i>1</i></div>
      <div class="pin" style="top:27.3%"><i>2</i></div>
      <div class="pin" style="top:31.8%"><i>3</i></div>
    </div>
    <div class="claims">
      <h2>One fact, said three ways</h2>
      <p>Each of these lines tells the athlete how much is left today. They sat within
        <b>150 pixels of each other</b>, and none of them was the screen's most important element.</p>
      <ul class="three">
        <li><em>1</em> “3 requirements remaining today”</li>
        <li><em>2</em> “1 of 4 done”</li>
        <li><em>3</em> “3 to go — your day is still open”</li>
      </ul>
      <p class="verdict">The header now gives orientation instead of repetition, and the two score lines
        collapse into one — because the “In progress” chip above already carries the reassurance that the
        day isn't lost.</p>
    </div>
  </section>

  ${pair('p1', 'Morning · one requirement in', 'Thursday 07:52 · seeded from real evidence',
    'The card, its border and its shadow are gone. The hero is excluded from the “premium pass” rule that was still painting an edge highlight on it, so the score now sits directly on the canvas. Hierarchy comes from <b>size and space</b> rather than another box — which is the entire argument for the type scale.',
    img.beforeMorning, img.afterMorning)}

  ${pair('p2', 'Midday · the day in motion', 'Thursday 13:10',
    'The subtitle carries the day and the team instead of a number the score card already owns. The ring grows from 102px to 128px; the numeral more than doubles. A three-digit score measures <b>89px against a 106px ring interior</b>, so 100 does not overflow.',
    img.beforeMidday, img.afterMidday)}

  ${pair('p3', 'Day one · nothing logged yet', 'Fresh account, 15:20',
    'The honest empty state survives untouched — this codebase already refuses to fabricate a first day, and that was worth protecting. Only the framing changed: one statement of where the athlete stands, not three.',
    img.beforeFirst, img.afterFirst)}

  ${pair('p4', 'Light mode · the same screen', 'Rendered with data-theme="light"',
    'Light mode was previously stubbed rather than shipped: <b>249 hardcoded colours</b> sat outside the token file against eight light-theme overrides, so brand tints stayed frozen at their dark values. Brand hues are now RGB triples that flip with the theme, and gradient fills pair a hue with a proper deep step instead of inverting.',
    img.beforeLight, img.afterLight)}

  <section class="metrics">
    <div class="cap">
      <h2>Measured, not asserted</h2>
      <p>Every figure below is produced by a scripted sweep that drives the real app in a browser and
        audits each screen. It is re-runnable: <span style="font-family:var(--data)">node scripts/qc-capture.mjs</span></p>
    </div>
    <div class="scroll">
      <table>
        <thead><tr><th>Measure</th><th style="text-align:right">Before</th><th style="text-align:right">After</th></tr></thead>
        <tbody>
          <tr><td>Statements of “how much is left” above the fold</td><td class="n was">3</td><td class="n now">1</td></tr>
          <tr><td>Daily score numeral</td><td class="n was">31px</td><td class="n now">52px</td></tr>
          <tr><td>Container borders around the score</td><td class="n was">1</td><td class="n now">0</td></tr>
          <tr><td>Light-mode contrast failures, all 61 screens</td><td class="n was">5</td><td class="n now">0</td></tr>
          <tr><td>Touch targets under 44px, 122 captures</td><td class="n was">59</td><td class="n now">0</td></tr>
          <tr><td>Hardcoded colours outside the token file</td><td class="n was">249</td><td class="n now">92</td></tr>
          <tr><td>Keyboard focus rings on suppressed fields</td><td class="n was">0 / 9</td><td class="n now">9 / 9</td></tr>
          <tr><td>Uncaught JavaScript errors in sweep</td><td class="n was">1</td><td class="n now">0</td></tr>
          <tr><td>Automated tests</td><td class="n was">2,571</td><td class="n now">2,558 + 5 new guards</td></tr>
          <tr><td>Adversarial authorization checks</td><td class="n was">417 / 419</td><td class="n now">419 / 419</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="next">
    <h2>What this screen proves, and what comes next</h2>
    <p class="note">Home is the first screen migrated to the design system, and it was chosen as the test of
      whether that system earns its keep. It does: once type could carry hierarchy, a border became
      removable rather than load-bearing.</p>
    <ul>
      <li><b>Score breakdown</b> — the number and its explanation should be the whole screen.</li>
      <li><b>Meal analysis</b> — already the strongest flow; it needs its three competing skeleton systems reduced to one.</li>
      <li><b>Coach home</b> — “who needs attention and why” should be answerable in a glance.</li>
      <li><b>Component consolidation</b> — 11 stat tiles, 15 progress bars, 21 pill styles and 46 card class names collapse to one of each. They exist because typography couldn't separate anything; now it can.</li>
    </ul>
  </section>

  <footer>
    Screenshots rendered from the shipped WebView app against seeded fixtures and a stubbed backend —
    no production data, and no number in these images was drawn by the capture script.
    Typeface is the product's own Plus Jakarta Sans.
  </footer>

</div>`;

writeFileSync(SP + 'home-redesign.html', html);
console.log('written', Math.round(html.length / 1024) + 'kb');
