// Meal-pipeline eval runner. Live (paid): POST each photo to analyze-meal, save the raw response,
// score it. Replay (free): re-score saved responses through the deterministic scoring core.
// Writes a baseline and diffs the previous one. Run: `npm run eval -- [--url=..] [--replay] [--no-baseline]`
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreMeal, type ManifestEntry, type MealResponse } from '../src/core/evalScore';

const DIR = dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d?: string) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : (process.argv.includes(`--${k}`) ? '' : d); };
const URL = arg('url', 'https://ftwrvylzoyznhbzhgism.supabase.co/functions/v1/analyze-meal')!;
const REPLAY = process.argv.includes('--replay');
const NO_BASELINE = process.argv.includes('--no-baseline');
const ANON = process.env.EVAL_ANON_KEY || '';

const manifest: ManifestEntry[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const respDir = join(DIR, 'responses'); if (!existsSync(respDir)) mkdirSync(respDir, { recursive: true });

async function getResponse(e: ManifestEntry): Promise<{ resp: MealResponse | null; ms: number }> {
  const cache = join(respDir, `${e.id}.json`);
  if (REPLAY) return { resp: existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : null, ms: 0 };
  const b64 = readFileSync(join(DIR, 'meals', e.photo)).toString('base64');
  const t0 = Date.now();
  // Per-meal request context (manifest `request`), so a plate can be posted as the athlete's
  // FIRST meal of the day the way the real client posts it. Every plate used to go out as a
  // context-free Dinner, which meant the prompt's Day context line — and every failure mode
  // living in it — was never once exercised by this suite. Entries without `request` produce a
  // byte-identical body to the old one, so their baselines stay comparable.
  const ctx = e.request || {};
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({
      mode: 'meal', mealType: ctx.mealType || 'Dinner', photoBase64: b64, phase: 'analyze',
      ...(ctx.dayContext ? { dayContext: ctx.dayContext } : {}),
      ...(ctx.athlete ? { athlete: ctx.athlete } : {}),
    }),
  });
  const ms = Date.now() - t0;
  const data = await res.json().catch(() => null) as any;
  const resp = data && data.kind === 'result' ? data as MealResponse : null;
  if (resp) writeFileSync(cache, JSON.stringify(resp, null, 2));
  return { resp, ms };
}

function aggregate(scored: ReturnType<typeof scoreMeal>[]) {
  const n = scored.length || 1;
  const mean = (f: (s: any) => number) => scored.reduce((a, s) => a + f(s), 0) / n;
  return {
    meals: scored.length,
    detection_recall: +mean((s) => s.detection.recall).toFixed(3),
    detection_precision: +mean((s) => s.detection.precision).toFixed(3),
    kcal_err_pct: +mean((s) => s.macroError.kcal.pct).toFixed(3),
    protein_err_pct: +mean((s) => s.macroError.protein.pct).toFixed(3),
    contradiction_rate: +mean((s) => (s.contradiction ? 1 : 0)).toFixed(3),
    // The read narrating the athlete's day instead of judging the plate. Higher is worse; see
    // scoreDayLeak. empty_day_rate is broken out because it is the one that reaches an athlete
    // as an insult to their morning ("Zero on the board", over their breakfast).
    day_leak_rate: +mean((s) => (s.dayLeak.leaked ? 1 : 0)).toFixed(3),
    empty_day_rate: +mean((s) => (s.dayLeak.emptyDay ? 1 : 0)).toFixed(3),
    verify_trigger_accuracy: +mean((s) => (s.verify.correct ? 1 : 0)).toFixed(3),
  };
}

/* The README calls this a regression GATE, so it has to be able to fail. Every one of these was
   previously a warning printed to a run that still exited 0 — which in CI is indistinguishable from
   a pass. Collected rather than thrown so one run reports every problem at once. */
const failures: string[] = [];

/* Case types the README's "Add a meal" checklist says the set must cover, and what each is for.
   Absent coverage is reported loudly: a suite of one clean plate cannot detect a regression in the
   paths that actually break, and until now nothing said so. */
const REQUIRED_CASES: Record<string, string> = {
  clear: 'a well-lit single plate — the happy path; verify must stay quiet',
  'poor-image': 'dark / blurred / partial — low confidence must trigger the accuracy verifier',
  'known-failure': 'a plate the model has been wrong about; guards the fix',
  allergen: 'a severe allergen present — must trigger the allergen verifier',
};

(async () => {
  if (!REPLAY && !ANON) { console.error('Set EVAL_ANON_KEY for a live run (or use --replay).'); process.exit(1); }
  const scored: ReturnType<typeof scoreMeal>[] = [];
  // The prose itself, kept so a run can be READ and not just tallied. Voice regressions are the
  // ones a metric notices last and an athlete notices first.
  const reads: { id: string; text: string }[] = [];
  let totalMs = 0, calls = 0;
  for (const e of manifest) {
    const { resp, ms } = await getResponse(e);
    totalMs += ms; if (!REPLAY && resp) calls++;
    if (!resp) {
      // A missing response is not a neutral event: that meal contributed nothing to the metrics,
      // so the aggregate silently describes a smaller set than the manifest claims.
      failures.push(`${e.id}: no response (${REPLAY ? 'nothing cached — run live first' : 'the live call failed'})`);
      console.warn(`  ${e.id}: no response`);
      continue;
    }
    scored.push(scoreMeal(resp, e));
    reads.push({ id: e.id, text: String(resp.analysis || '').trim() });
  }

  if (!scored.length) failures.push('measured 0 meals — this run proves nothing');
  const agg = aggregate(scored);
  console.log('\n=== AGGREGATE ==='); console.table(agg);
  console.log(`latency: avg ${scored.length ? Math.round(totalMs / Math.max(calls, 1)) : 0}ms/call over ${calls} live calls`);
  if (!REPLAY) console.log('cost: read ai_cost_daily for this run window (8a records every eval call as mode=meal).');

  // per-case breakdown
  const byCase: Record<string, ReturnType<typeof scoreMeal>[]> = {};
  for (const s of scored) (byCase[s.caseType] ||= []).push(s);
  console.log('\n=== BY CASE ==='); console.table(Object.fromEntries(Object.entries(byCase).map(([k, v]) => [k, aggregate(v)])));

  // The reads, in full. The point of a paid run is to SEE what the athlete would have read; a
  // table of means cannot tell you the model opened by narrating an empty board.
  console.log('\n=== READS ===');
  const leakById = new Map(scored.map((s) => [s.id, s.dayLeak]));
  for (const r of reads) {
    const leak = leakById.get(r.id);
    const flags = [leak?.emptyDay ? 'EMPTY-DAY' : '', leak?.dayTotal ? 'DAY-TOTAL' : ''].filter(Boolean).join(' + ');
    console.log(`\n  ${r.id}${flags ? `  ⚠ ${flags}` : ''}\n  ${r.text || '(no analysis returned)'}`);
    if (flags) failures.push(`${r.id}: the read narrated the athlete's day (${flags})`);
  }

  // baseline diff (upgrade #1)
  const baseDir = join(DIR, 'baselines'); if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  const latest = join(baseDir, 'latest.json');
  if (existsSync(latest)) {
    const prev = JSON.parse(readFileSync(latest, 'utf8')).aggregate;
    console.log('\n=== VS BASELINE ===');
    for (const k of Object.keys(agg)) {
      const d = (agg as any)[k] - (prev[k] ?? 0);
      // Metrics where UP is worse. `leak` must be listed here or a run that started narrating the
      // athlete's day back at them would score as an improvement.
      const worse = /err_pct|contradiction|leak|empty_day/.test(k) ? d > 0.02 : d < -0.02;
      if (Math.abs(d) >= 0.001) console.log(`  ${worse ? '⚠ ' : '  '}${k}: ${prev[k]} → ${(agg as any)[k]} (${d > 0 ? '+' : ''}${d.toFixed(3)})`);
      // A regression past the threshold is the whole reason this file exists. It used to print a
      // warning glyph into a run that exited 0, so CI called it a pass.
      if (worse) failures.push(`${k} regressed: ${prev[k]} → ${(agg as any)[k]} (${d > 0 ? '+' : ''}${d.toFixed(3)})`);
    }
  }

  // Coverage: which of the README's required case types the set actually exercises.
  console.log('\n=== COVERAGE ===');
  const present = new Set(manifest.map((e) => e.caseType));
  const missing: string[] = [];
  for (const [type, why] of Object.entries(REQUIRED_CASES)) {
    const n = manifest.filter((e) => e.caseType === type).length;
    console.log(`  ${n ? '✓' : '·'} ${type.padEnd(14)} ${n} case${n === 1 ? '' : 's'}${n ? '' : `  — missing: ${why}`}`);
    if (!n) missing.push(type);
  }
  for (const t of present) if (!(t in REQUIRED_CASES)) console.log(`  ? ${t.padEnd(14)} (not in the required set)`);
  if (missing.length) {
    // Reported, not fatal: the gap needs real photographed plates, which is a team task and not
    // something a run can conjure. Loud so it stops being invisible — but it must not block the
    // deterministic replay that today's contributors do rely on.
    console.log(`\n  ${missing.length} required case type(s) uncovered: ${missing.join(', ')}`);
    console.log('  Until these exist, a green run means "the one clean plate still works", not "the pipeline is safe".');
  }
  if (!NO_BASELINE && !REPLAY) {
    const stamp = process.env.EVAL_STAMP || 'run';
    const rec = { aggregate: agg, meals: scored.length };
    // The stamped record is always kept: it is this run's history, pass or fail, and the row you
    // want when you come back asking "how noisy is this metric actually?".
    writeFileSync(join(baseDir, `${stamp}.json`), JSON.stringify(rec, null, 2));
    // BUT latest.json — the thing the NEXT run is judged against — is only moved by a run that
    // passed. A failing run used to overwrite the very baseline it had just failed against, so the
    // regression it caught could never be caught again: the next run diffed against the worse
    // number and went green. That is the same "warning printed to a run that exits 0" failure this
    // file was rewritten to kill, one level up (caught 2026-09-07 by a run that regressed).
    if (!failures.length) {
      writeFileSync(latest, JSON.stringify(rec, null, 2));
      console.log(`\nbaseline written → eval/baselines/latest.json`);
    } else {
      console.log(`\nrun recorded → eval/baselines/${stamp}.json (latest.json UNCHANGED: this run failed)`);
    }
  }

  if (failures.length) {
    console.error(`\n=== FAILED (${failures.length}) ===`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`\nOK — ${scored.length} meal(s) measured, no regression against the baseline.`);
})();
