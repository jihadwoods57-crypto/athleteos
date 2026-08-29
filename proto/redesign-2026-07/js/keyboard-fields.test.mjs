/* Every control the app renders that raises a keyboard OR a native picker must be one that
 * keyboard.js's isField() recognises.
 *
 * Why this is load-bearing: `--kb` is written only inside sync(), and sync() is reached from a
 * visualViewport event or from the focusin listener, which bails early on anything isField()
 * rejects. `--kb` drives `.device { height: calc(100dvh - var(--kb)) }` on phone-native, so a
 * `--kb` that sticks collapses the shell — and a collapsed shell can be neither scrolled nor
 * tapped. "Schedule a commitment" is the screen that exposed it: three <input type="time">, two
 * type="number" and a <select>, and `time` was absent from TEXTY while <select> was rejected by
 * tag, so focusin ignored every control on the form.
 *
 * Regex over sources, in the manner of depill.test.mjs: it cannot see a type assembled at runtime,
 * but it catches a literal one added to a screen without being taught to the keyboard layer.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KB = readFileSync(join(HERE, 'keyboard.js'), 'utf8');

/* The two lists, read out of keyboard.js so the test cannot drift from the code it guards. */
const listOf = (name) => {
  const m = KB.match(new RegExp(`const ${name} = /\\^\\(([^)]*)\\)\\$/i;`));
  assert.ok(m, `keyboard.js no longer declares ${name} as an anchored regex — update this test`);
  return m[1].split('|');
};
const TEXTY = listOf('TEXTY');
const PICKER = listOf('PICKER');
const KNOWN = new Set([...TEXTY, ...PICKER].filter(Boolean));

/* Types that raise no keyboard and no picker, so the shell has nothing to resize for. */
const NO_INPUT_UI = new Set(['checkbox', 'radio', 'range', 'file', 'hidden', 'submit', 'button', 'reset', 'image', 'color']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}
const SOURCES = walk(HERE).filter((p) => !p.endsWith('.test.mjs'));

test('isField knows the picker types, not just the texty ones', () => {
  for (const t of ['time', 'date', 'datetime-local', 'month', 'week']) {
    assert.ok(KNOWN.has(t), `<input type="${t}"> opens a native picker over the page and must be a field`);
  }
});

test('a <select> is a field: it raises a picker the shell has to resize for', () => {
  assert.match(KB, /tag === 'select'/, 'isField must handle <select> by tag; it has no readOnly, only disabled');
});

test('every input type rendered anywhere in the proto is classified', () => {
  const unknown = new Map();
  for (const p of SOURCES) {
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/<input\b[^>]*?\btype="([a-z-]+)"/gi)) {
      const t = m[1].toLowerCase();
      if (KNOWN.has(t) || NO_INPUT_UI.has(t)) continue;
      if (!unknown.has(t)) unknown.set(t, relative(HERE, p));
    }
  }
  assert.deepEqual([...unknown], [],
    `input types no rule covers: ${[...unknown].map(([t, f]) => `"${t}" (${f})`).join(', ')}. ` +
    'If it raises a keyboard or a picker, add it to TEXTY/PICKER in keyboard.js; if it raises ' +
    'neither, add it to NO_INPUT_UI here.');
});

test('the shell can always recover from a stuck --kb', () => {
  assert.match(KB, /visibilitychange/,
    're-measuring when the app is returned to is the only guaranteed way back from a --kb that stuck');
});
