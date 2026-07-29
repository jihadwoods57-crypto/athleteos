/* Guards the de-pill rule (commit 4a8990d, written up in qc/depill-note.html).
 *
 *   --r-pill (fully round)   = a read-only bead of information.
 *   --r-chip (softer corner) = something you tap or type into.
 *
 * The rule had NO enforcement — it lived in a commit message and a hand-written note, and it
 * had already eroded in four places by the time anyone looked again. This catches those four
 * shapes on the way in.
 *
 * Honest about its limits: this is regex over template literals, not a parser. It cannot see a
 * class assembled at runtime, and it will not catch every possible violation. It catches the
 * regressions that actually happened, which is the point.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_DIR = join(HERE, '..', 'css');

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

const CSS = walk(CSS_DIR, '.css').map((f) => readFileSync(f, 'utf8')).join('\n');
const JS = walk(HERE, '.js').map((f) => readFileSync(f, 'utf8')).join('\n');

/* Every rule in the stylesheet as [selectorList, declarations]. Comments are stripped first so a
   commented-out example can't register as a rule. */
const RULES = (() => {
  const src = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
})();

/* Declaration blocks of every rule whose selector mentions this class — `.co-chip` has to find
   `.co-seg .co-chip`, so matching only rules that START with the class would silently find
   nothing and make the assertion vacuous. */
function blocksFor(cls) {
  const token = new RegExp(`\\.${cls.replace(/^\./, '')}\\b`);
  return RULES.filter(([sel]) => token.test(sel) && !/^@/.test(sel)).map(([, decls]) => decls);
}

const RADIUS_PILL = /border-radius:\s*(var\(--r-pill\)|999px)/;

/* Controls: tapped or typed into. Must NOT wear the fully-round pill radius. */
const TAPPABLE = ['.co-chip', '.chp', '.qa', '.fx-chip', '.wb2'];
/* Read-only beads: a small fact you look at. The pill is theirs. */
const READONLY = ['.status-pill', '.xpill', '.tier-chip', '.stk-pill', '.foodchip'];

test('a tappable control never wears the pill radius', () => {
  const bad = [];
  for (const sel of TAPPABLE) {
    const blocks = blocksFor(sel);
    // A selector that has vanished means this guard stopped guarding anything — fail loudly
    // rather than passing on an empty set.
    assert.ok(blocks.length, `${sel} is not in the stylesheet — update this guard or restore it`);
    if (blocks.some((b) => RADIUS_PILL.test(b))) bad.push(sel);
  }
  assert.deepEqual(bad, [], `these are tappable and must use --r-chip, not the pill: ${bad.join(', ')}`);
});

test('a read-only bead keeps the pill radius', () => {
  const bad = [];
  for (const sel of READONLY) {
    const blocks = blocksFor(sel);
    assert.ok(blocks.length, `${sel} is not in the stylesheet — update this guard or restore it`);
    if (!blocks.some((b) => RADIUS_PILL.test(b))) bad.push(sel);
  }
  assert.deepEqual(bad, [], `these are read-only and should stay pills: ${bad.join(', ')}`);
});

test('a read-only bead is never itself a tap target', () => {
  // <span class="… status-pill …" data-go=…> — the pill labels the row; the ROW is the target.
  const re = /class="[^"]*\b(status-pill|xpill|tier-chip|stk-pill|foodchip)\b[^"]*"[^>]*?\s(data-go|data-act|role="button")/g;
  const hits = [...JS.matchAll(re)].map((m) => m[0].slice(0, 120));
  assert.deepEqual(hits, [], `read-only pills must not carry their own handler:\n${hits.join('\n')}`);
});

test('every requirement pill label is a state, not a command', () => {
  // A pill sits inside a tappable row, so an imperative reads as the button. 'Open' shipped for
  // months next to Logged / Overdue / Upcoming and was the odd one out.
  const m = JS.match(/const PILL = \{([^}]*)\}/);
  assert.ok(m, 'exec.js PILL map not found');
  const values = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const IMPERATIVES = ['Open', 'Log', 'Start', 'Go', 'Tap', 'Do', 'Complete', 'Add'];
  const bad = values.filter((v) => IMPERATIVES.includes(v));
  assert.deepEqual(bad, [], `pill labels must be state nouns, not commands: ${bad.join(', ')}`);
});

test('a tappable div declares itself to assistive tech', () => {
  // .roster-row and .coach-stat are <div>s that navigate. Without role+tabindex a screen reader
  // announces nothing and a keyboard cannot reach them.
  const bad = [];
  for (const cls of ['roster-row', 'coach-stat']) {
    const re = new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*?\\sdata-go=`, 'g');
    for (const hit of JS.matchAll(re)) {
      // The opening tag continues past data-go; grab enough of it to look for role.
      const tail = JS.slice(hit.index, JS.indexOf('>', hit.index) + 1);
      if (!/\brole=/.test(tail) || !/\btabindex=/.test(tail)) bad.push(hit[0].slice(0, 100));
    }
  }
  assert.deepEqual(bad, [], `tappable divs need role + tabindex:\n${bad.join('\n')}`);
});
