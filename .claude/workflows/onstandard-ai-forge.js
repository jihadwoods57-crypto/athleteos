// .claude/workflows/onstandard-ai-forge.js
// Bespoke autonomous construction crew for OnStandard's AI layer. Works a
// dependency-ordered queue of build slices (AI-BUILD-QUEUE.md); each slice goes
// Build -> Smoke -> Critique(4 safety floors) -> Adversarial Verify -> Gate, and
// only a slice that passes ALL of it is committed+tagged on the current branch.
// Never touches master, never applies migrations to live, never sends anything.
export const meta = {
  name: 'onstandard-ai-forge',
  description: 'Autonomous crew that builds OnStandard\'s AI layer (Copilot, Memory, Profile, meal-coaching voice) slice by slice, gated by the authority-boundary / numbers-never-change / RLS-consent / green-build safety floors',
  whenToUse: 'Overnight-autonomous build of the doc-05 AI systems onto a clean crew branch. Operator ensures a green, committed tree first. Each passing slice is committed and tagged ai-forge/<date>-<sliceId>; migrations are authored, never applied to live.',
  phases: [
    { title: 'Build' },
    { title: 'Smoke' },
    { title: 'Critique' },
    { title: 'Verify' },
    { title: 'Report' },
  ],
};

// --- Run config (tune via args) ---
const MAX_ATTEMPTS_PER_SLICE = 3;
const DEFAULT_CEILING = 1_200_000;   // construction slices are heavier than proto polish
const PER_SLICE_RESERVE = 200_000;   // refuse to start a slice that can't fit
const SPEC = 'docs/architecture/05-ai-systems.md';
const CORES = 'src/core/{attention,weeklyReport,adherence,nutritionMemory,coaching,messaging,membership,consent}.ts';

const runDate = (args && args.runDate) || 'undated';
const tokenCeiling = (args && args.tokenCeiling) || DEFAULT_CEILING;
const builderModel = (args && args.builderModel) || undefined; // set 'fable' once available; else inherit
const criticModel = (args && args.criticModel) || undefined;   // inherit (opus) by default
const dryRun = !!(args && args.dryRun);                         // gate passes but skip the commit

// --- Slice queue (mirror of AI-BUILD-QUEUE.md — KEEP IN SYNC) ---
// builders roles run sequentially within a slice: 'core' | 'migration' | 'edge' | 'ui'
const SLICES = [
  { id: 'S1',  phase: 'P1', title: 'aiAuthority.arbitrate',        builders: ['core'],         needs: [],            spec: '§8 authority boundary' },
  { id: 'S2',  phase: 'P1', title: 'assist ContextPack contract',   builders: ['core'],         needs: [],            spec: '§3 seam + task enum' },
  { id: 'S3',  phase: 'P1', title: 'personality.clampForAudience',  builders: ['core'],         needs: [],            spec: '§7 personality' },
  { id: 'S4',  phase: 'P2', title: 'copilot core (7 tools)',        builders: ['core'],         needs: ['S1','S2'],   spec: '§6 copilot tool catalog + CopilotResult' },
  { id: 'S5',  phase: 'P2', title: 'copilot_artifacts migration',   builders: ['migration'],    needs: ['S4'],        spec: '§6.2 copilot_artifacts + activity_log + draft->sent RPC' },
  { id: 'S6',  phase: 'P2', title: 'assist edge function',          builders: ['edge'],         needs: ['S4','S5'],   spec: '§3/§6.3 gatekeeper: ContextPack + arbitrate + fallback + audit' },
  { id: 'S7',  phase: 'P2', title: 'copilot coach UI',              builders: ['ui'],           needs: ['S6'],        spec: '§6 coach query + draft review/edit/send' },
  { id: 'S8',  phase: 'P3', title: 'athlete_memory_facts migration',builders: ['migration'],    needs: ['S5'],        spec: '§5.1 table + mem_self/mem_coach_rd RLS' },
  { id: 'S9',  phase: 'P3', title: 'memory core + mealEdit wire',   builders: ['core'],         needs: ['S8'],        spec: '§5 propose/validate/promote/retrieveForTask' },
  { id: 'S10', phase: 'P3', title: 'performance_profiles migration',builders: ['migration'],    needs: ['S5'],        spec: '§4 table + pp RLS + RPCs' },
  { id: 'S11', phase: 'P3', title: 'performanceProfile core',       builders: ['core'],         needs: ['S10'],       spec: '§4 buildProfileView projection' },
  { id: 'S12', phase: 'P3', title: 'memory_extract + confirm UI',   builders: ['edge','ui'],    needs: ['S6','S9'],   spec: '§5.2 LLM-proposes / deterministic-validates / safety confirm' },
  { id: 'S13', phase: 'P3', title: 'performance profile coach UI',  builders: ['ui'],           needs: ['S11'],       spec: '§4 coach-facing profile view' },
  { id: 'S14', phase: 'P3', title: 'behavior evidence_n job',       builders: ['edge'],         needs: ['S9'],        spec: '§5.2 scheduled deterministic accrual' },
  { id: 'S15', phase: 'P4', title: 'meal-coaching voice',           builders: ['core','edge'],  needs: ['S2','S3'],   spec: '§9 meal_coaching task + number-locked voice guard' },
  { id: 'S16', phase: 'P4', title: 'personality wired into assist', builders: ['edge'],         needs: ['S3','S6'],   spec: '§7 style token applied server-side' },
];

// --- Structured-output schemas ---
const BUILD_SCHEMA = { type: 'object', additionalProperties: false, required: ['touchedFiles', 'summary'], properties: {
  touchedFiles: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } } };
const SMOKE_SCHEMA = { type: 'object', additionalProperties: false, required: ['ok', 'errors'], properties: {
  ok: { type: 'boolean' }, errors: { type: 'array', items: { type: 'string' } } } };
const CRITIC_SCHEMA = { type: 'object', additionalProperties: false, required: ['pass', 'findings'], properties: {
  pass: { type: 'boolean' },
  findings: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['severity', 'file', 'line', 'rule', 'summary'], properties: {
      severity: { enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, line: { type: 'integer' },
      rule: { type: 'string' }, summary: { type: 'string' } } } } } };
const VERDICT_SCHEMA = { type: 'object', additionalProperties: false, required: ['refuted', 'why'], properties: {
  refuted: { type: 'boolean' }, why: { type: 'string' } } };
const COMMIT_SCHEMA = { type: 'object', additionalProperties: false, required: ['committed', 'tag'], properties: {
  committed: { type: 'boolean' }, tag: { type: ['string', 'null'] } } };

// --- Shared constraints every builder obeys ---
const RULES = `Read ${SPEC} for this slice's exact contract before writing. Reuse the existing deterministic cores (${CORES}) — never rebuild them, never let the model recompute a number. Non-negotiables (doc-05): the LLM only phrases/drafts/summarizes/retrieves — it NEVER writes a score/target/plan and NEVER sends; every model output must be validated server-side and demoted to a suggestion on conflict; any AI language surface must preserve every number exactly (mirror src/core/nutritionMemoryVoice.mergeRephrasedInsights) and keep the medical/scope disclaimers; no athlete outside membership.canView() may reach a prompt; keep the deterministic fallback so the app works with AI off. Do NOT run git — leave your edits uncommitted; the crew commits after the gate. Do NOT apply migrations to any database. Report EXACTLY the files you created or modified in touchedFiles (relative paths).`;

const carryBlock = (findings) => findings.length
  ? `\n\nFindings to fix from the last attempt:\n${findings.map(f => `- ${f.file}:${f.line} — ${f.rule} — ${f.summary}`).join('\n')}`
  : '\n\nFirst attempt on this slice.';

function builderPrompt(slice, role, findings) {
  const roleBrief = {
    core: `Write the pure src/core module(s) for "${slice.title}" plus colocated *.test.ts. Pure functions only — no React Native imports in src/core. Cover the number-preservation / authority invariants with tests.`,
    migration: `Author the SQL migration for "${slice.title}" under supabase/migrations/ following the house style (see 0005_grants.sql / 0013_security_hardening.sql): forward-only, idempotent, RLS enabled, least-privilege grants, SECURITY DEFINER + set search_path on functions. AUTHOR ONLY — never apply it to a database. Include the guardrail note that the founder applies it.`,
    edge: `Author the Deno edge function for "${slice.title}" under supabase/functions/. It is the gatekeeper: build the RLS-scoped ContextPack (no PHI/photos/raw names), call the model, validate output through the authority arbiter, fall back to the deterministic result on any failure, and log to the audit table. Split models (Fable 5 for deep analysis, Opus 4.8 for routine) with a server-side fallback on health-adjacent refusals. Keep the ANTHROPIC key server-side.`,
    ui: `Wire the React Native screen(s) for "${slice.title}". Follow the existing seam pattern (inert + honest labels until isAiConfigured; deterministic fallback always renders). Coach-facing surfaces only unless the slice is explicitly the bounded athlete meal-coaching voice.`,
  }[role];
  return `You are the ${role} builder on the OnStandard AI Forge crew. Slice ${slice.id}: ${slice.title} (spec: ${slice.spec}). ${roleBrief}\n\n${RULES}${carryBlock(findings)}`;
}

// --- Critic prompts (the four floors) ---
function authorityCritic(touched) {
  return `You are the AUTHORITY-BOUNDARY critic (read-only; do not edit). Inspect the uncommitted diff for these files: ${touched.join(', ')}. Verify against ${SPEC} §8: does ANY path let the model write a score/target/plan, or send a message, or bypass arbitrate()? A draft must be status 'draft' with no send capability in the edge fn. Return pass=false with blocker findings (file:line + rule) if the authority boundary can be crossed; pass=true only if every model output is validated and demoted on conflict.`;
}
function numbersCritic(touched) {
  return `You are the NUMBERS-NEVER-CHANGE critic (read-only). Inspect the diff for ${touched.join(', ')}. Any AI language surface here MUST preserve every number exactly and MUST have a test proving a numeric drift is rejected (pattern: src/core/nutritionMemoryVoice.mergeRephrasedInsights). Disclaimers must always append regardless of personality. Return pass=false with blocker findings if a number could drift or the guard/test is missing.`;
}
function rlsCritic(touched) {
  return `You are the RLS/CONSENT critic (read-only). Inspect the diff for ${touched.join(', ')}. Verify against ${SPEC} §6.3 + src/core/consent.ts: no athlete outside membership.canView() can reach a prompt; the ContextPack carries no photos/PHI/raw names; the realDataConsent gate is intact for any photo egress; RLS policies scope every new table to the owner + authorized coach only. Return pass=false with blocker findings on any leak.`;
}
function specCritic(slice, touched) {
  return `You are the SPEC-FIDELITY critic (read-only). Inspect the diff for ${touched.join(', ')} against ${SPEC} (${slice.spec}). Do the table shapes, tool catalog, CopilotResult frame, and task contract match the founder spec? Is the deterministic fallback present? Return pass=false with findings on any drift from the spec.`;
}
function refutePrompt(floor, touched) {
  return `You are a skeptical security reviewer (read-only; do NOT edit). A prior critic claims the ${floor} floor holds for the diff in ${touched.join(', ')}. Try HARD to break it — construct a concrete input or code path where the model writes a number/target/plan, sends a message, leaks an athlete the coach can't see, or drifts a figure. Default refuted=true if you cannot clearly confirm the floor is airtight. refuted=true means you found a hole (the floor FAILS). Explain the exact path.`;
}
function smokePrompt() {
  return `Run the smoke gate from the repo root: \`npm run typecheck\` then \`npm run test\` (jest). Return {ok:true, errors:[]} only if BOTH pass clean. If either fails, return ok:false with the concrete error lines (file:line + message) in errors. Do NOT edit files, do NOT run git.`;
}
function revertPrompt(touched) {
  return `Restore the working tree for this failed slice attempt. Revert ONLY these paths — never touch any other file, never use \`git checkout -- .\` or \`git add -A\`: ${touched.join(', ')}. For tracked files run \`git checkout -- <path>\`; for files this attempt newly created (untracked) delete them with \`rm\`. Confirm \`git status --short\` shows none of these paths remaining.`;
}
function commitPrompt(slice, touched) {
  return `Commit this passing slice from the repo root. Stage ONLY these paths (never \`git add -A\`): ${touched.join(', ')}. Then \`git commit\` with message "feat(ai): ${slice.id} ${slice.title} — via onstandard-ai-forge" and \`git tag -f ai-forge/${runDate}-${slice.id}\`. Do NOT push, do NOT touch master, do NOT apply any migration. Return {committed:true, tag:"ai-forge/${runDate}-${slice.id}"}.`;
}

log(`OnStandard AI Forge starting — runDate=${runDate}, ceiling=${tokenCeiling}, slices=${SLICES.length}, dryRun=${dryRun}`);

const done = new Set();
const results = [];
let stopReason = 'queue-complete';

for (const slice of SLICES) {
  // dependency gate
  const missing = slice.needs.filter((d) => !done.has(d));
  if (missing.length) {
    log(`${slice.id}: SKIPPED — unmet deps ${missing.join(',')}`);
    results.push({ id: slice.id, status: 'skipped', reason: `deps ${missing.join(',')}` });
    continue;
  }
  // token ceiling
  if (budget.total && budget.remaining() < PER_SLICE_RESERVE) { stopReason = 'token-ceiling'; break; }

  let carry = [];
  let passed = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_SLICE; attempt++) {
    // 1. BUILD (roles sequential — shared tree, avoid conflicts)
    phase('Build');
    const touched = [];
    for (const role of slice.builders) {
      const b = await agent(builderPrompt(slice, role, carry), { label: `${slice.id}:build:${role}`, phase: 'Build', schema: BUILD_SCHEMA, model: builderModel, effort: 'high' });
      if (b && Array.isArray(b.touchedFiles)) touched.push(...b.touchedFiles);
    }
    const touchedList = [...new Set(touched)].filter(Boolean);
    if (!touchedList.length) { carry = [{ file: slice.id, line: 0, rule: 'build produced no files', summary: 'builder returned no touchedFiles' }]; continue; }

    // 2. SMOKE (typecheck + test; no git)
    phase('Smoke');
    const smoke = await agent(smokePrompt(), { label: `${slice.id}:smoke`, phase: 'Smoke', schema: SMOKE_SCHEMA });
    if (!smoke || smoke.ok !== true) {
      const errs = (smoke && smoke.errors && smoke.errors.length) ? smoke.errors : ['smoke agent returned no result'];
      log(`${slice.id} a${attempt}: SMOKE FAILED (${errs.length}) — reverting, retrying`);
      await agent(revertPrompt(touchedList), { label: `${slice.id}:revert`, phase: 'Smoke' });
      carry = errs.map((e, i) => ({ file: 'build', line: 0, rule: 'must typecheck + test clean', summary: e }));
      continue;
    }

    // 3. CRITIQUE (four safety floors, parallel, read-only)
    phase('Critique');
    const [authority, numbers, rls, spec] = await parallel([
      () => agent(authorityCritic(touchedList), { label: `${slice.id}:floor:authority`, phase: 'Critique', schema: CRITIC_SCHEMA, model: criticModel }),
      () => agent(numbersCritic(touchedList), { label: `${slice.id}:floor:numbers`, phase: 'Critique', schema: CRITIC_SCHEMA, model: criticModel }),
      () => agent(rlsCritic(touchedList), { label: `${slice.id}:floor:rls`, phase: 'Critique', schema: CRITIC_SCHEMA, model: criticModel }),
      () => agent(specCritic(slice, touchedList), { label: `${slice.id}:floor:spec`, phase: 'Critique', schema: CRITIC_SCHEMA, model: criticModel }),
    ]);
    const floors = { authority, numbers, rls, spec };
    const floorFindings = Object.values(floors).filter(Boolean).flatMap((c) => c.findings.filter((f) => f.severity === 'blocker'));
    // a null critic fails safe to "not passing"
    const floorsPass = [authority, numbers, rls, spec].every((c) => c && c.pass === true);

    // 4. ADVERSARIAL VERIFY the three safety floors that claim to pass
    phase('Verify');
    const safetyFloors = [['authority', authority], ['numbers', numbers], ['rls', rls]].filter(([, c]) => c && c.pass === true).map(([name]) => name);
    const verdicts = await parallel(safetyFloors.map((name) => () => agent(refutePrompt(name, touchedList), { label: `${slice.id}:refute:${name}`, phase: 'Verify', schema: VERDICT_SCHEMA, model: criticModel }).then((v) => ({ name, v }))));
    const holes = verdicts.filter(Boolean).filter(({ v }) => v && v.refuted === true).map(({ name }) => name);

    // 5. GATE
    if (floorsPass && holes.length === 0) {
      if (dryRun) {
        log(`${slice.id} a${attempt}: PASS (dry-run — not committing). Leaving edits uncommitted.`);
        await agent(revertPrompt(touchedList), { label: `${slice.id}:dryrun-revert`, phase: 'Report' });
      } else {
        const c = await agent(commitPrompt(slice, touchedList), { label: `${slice.id}:commit`, phase: 'Report', schema: COMMIT_SCHEMA });
        log(`${slice.id} a${attempt}: PASS — committed ${c && c.tag}`);
      }
      done.add(slice.id);
      results.push({ id: slice.id, status: 'passed', attempts: attempt, tag: dryRun ? null : `ai-forge/${runDate}-${slice.id}` });
      passed = true;
      break;
    }

    // fail: revert + carry findings into the next attempt
    log(`${slice.id} a${attempt}: GATE FAILED — floorsPass=${floorsPass} holes=[${holes.join(',')}] — reverting, retrying`);
    await agent(revertPrompt(touchedList), { label: `${slice.id}:revert`, phase: 'Verify' });
    carry = floorFindings.length ? floorFindings : holes.map((h) => ({ file: 'safety', line: 0, rule: `${h} floor`, summary: `adversarial verifier broke the ${h} floor` }));
  }

  if (!passed) {
    log(`${slice.id}: BLOCKED after ${MAX_ATTEMPTS_PER_SLICE} attempts`);
    results.push({ id: slice.id, status: 'blocked', attempts: MAX_ATTEMPTS_PER_SLICE });
  }
}

// --- Report ---
phase('Report');
const passedN = results.filter((r) => r.status === 'passed').length;
const blocked = results.filter((r) => r.status === 'blocked').map((r) => r.id);
const skipped = results.filter((r) => r.status === 'skipped').map((r) => r.id);
log(`OnStandard AI Forge done — stop=${stopReason}, passed ${passedN}/${SLICES.length}, blocked=[${blocked.join(',')}], skipped=[${skipped.join(',')}]`);
return { runDate, stopReason, dryRun, passed: passedN, total: SLICES.length, blocked, skipped, results };
