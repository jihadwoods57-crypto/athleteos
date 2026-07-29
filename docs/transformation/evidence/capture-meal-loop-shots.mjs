import { launch, goto, evalJs, screenshot, sleep } from 'file:///C:/Users/Administrator/Downloads/athleteos/web/landing-src/lib/cdp.mjs';
import { SEEDS } from 'file:///C:/Users/Administrator/Downloads/athleteos/web/landing-src/lib/seeds.mjs';
import { sbStubSource, ROSTER_ATHLETES } from 'file:///C:/Users/Administrator/Downloads/athleteos/web/landing-src/lib/sb-stub.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
const SP='C:/Users/ADMINI~1/AppData/Local/Temp/claude/c--Users-Administrator-Downloads-athleteos/e89ca069-81fe-4098-a63f-78875c7e7c02/scratchpad/';
const R='C:/Users/Administrator/Downloads/athleteos/';
const photo = 'data:image/jpeg;base64,' + readFileSync(R+'proto/redesign-2026-07/assets/meal-lunch.jpg').toString('base64');
const clock = `(() => { const F=new Date(2026,6,23,13,10,0).getTime(); const R=Date;
  const D=function(...a){return a.length?new R(...a):new R(F)}; D.now=()=>F; D.parse=R.parse; D.UTC=R.UTC;
  D.prototype=R.prototype; Object.setPrototypeOf(D,R); globalThis.Date=D; })();`;
const label = process.argv[2] || 'after';

const b = await launch({ port: 9441, scale: 2 });
const shots = [
  ['camera-confirm', 'camera-confirm', ''],
  ['analyzing', 'analyzing', ''],
  ['meal-questions', 'meal-questions', `m.questions = ['How much rice was on the plate?','Was anything cooked in oil or butter?'];`],
];
for (const [name, route, extra] of shots) {
  const page = await b.newPage({ width: 390, height: 844 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: clock });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: sbStubSource({ todayISO:'2026-07-23', athletes: ROSTER_ATHLETES }) });
  await goto(page, 'http://localhost:8799/index.html', { settleMs: 1200 });
  await evalJs(page, `(async () => { ${SEEDS.dayMidday} return 1; })()`);
  // Stage a captured photo so the confirm / analyzing screens have something to render.
  await evalJs(page, `(async () => {
    const st = await import('/js/state.js');
    const m = st.MEAL;
    m.key='lunch'; m.mealType='Lunch'; m.photoDataUrl=${JSON.stringify(photo)};
    m.photoBase64='x'; m.live=true; m.source='live'; m.capturedAtMin=790; m.photoHash='h1';
    ${extra}
    return 1; })()`);
  if (route === 'analyzing') {
    // Hold the request open so the interstitial shows what the athlete actually stared at,
    // rather than falling through to its failure copy.
    await evalJs(page, `(() => { const inv = window.sb.functions.invoke.bind(window.sb.functions);
      window.sb.functions.invoke = (n, o) => n === 'analyze-meal' ? new Promise(() => {}) : inv(n, o); return 1; })()`);
  }
  await evalJs(page, `(() => { location.hash='#${route}'; return 1; })()`);
  await sleep(1600);
  await evalJs(page, `(()=>{window.scrollTo(0,document.body.scrollHeight);return 1})()`);
  await sleep(300);
  writeFileSync(SP + label + '-' + name + '.png', await screenshot(page, { format:'png' }));
  const t = await evalJs(page, `(document.body.innerText||'').replace(/\s+/g,' ').slice(0,110)`);
  console.log((label+'/'+name).padEnd(28), '|', t);
  await b.send('Target.closeTarget', { targetId: page.targetId });
}
await b.close();
