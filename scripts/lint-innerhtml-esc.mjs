#!/usr/bin/env node
// Guards the proto's XSS discipline: every user-controlled value interpolated into an innerHTML
// (or insertAdjacentHTML) template must go through esc(). The 2026-07-15 stress-test audit verified
// the current code is clean; this keeps a future unescaped `${userName}` from silently slipping in.
//
//   node scripts/lint-innerhtml-esc.mjs        → exits 1 if any risky interpolation is found
//
// Heuristic (no full parser): finds innerHTML/insertAdjacentHTML template literals, then within each
// flags any `${…}` whose expression references a user-data-shaped name and is NOT wrapped in esc().
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'proto/redesign-2026-07/js');

// Names that carry user/coach/athlete-authored free text — the XSS-prone interpolations. Matched as
// a PROPERTY ACCESS (`.text`, `.note`, `c.name`), which is how user data reaches templates here
// (fetched-row fields). A bare identifier like `${body}` is rendered markup, not raw user text.
const USER_DATA = /\.(name|note|text|msg|message|title|body|desc|description|comment|reason|question|answer|bio|username|handle|email|label|caption|content)\b/i;
// Safe wrappers/helpers: esc() escapes; icon()/scoreRing()/smartReply() emit trusted markup only.
const SAFE_CALL = /\besc\s*\(|\bescAttr\s*\(|\bicon\s*\(|\bscoreRing\s*\(|\bsparkline\s*\(|\bsmartReply\s*\(/;

/** Extract every innerHTML/insertAdjacentHTML template-literal body from source. */
function templates(src) {
  const out = [];
  const re = /(innerHTML\s*\+?=\s*|insertAdjacentHTML\s*\([^,]+,\s*)/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '`') continue;            // only template literals carry ${…}
    // read to the matching backtick, tolerating escaped backticks
    let j = i + 1, depth = 0;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === '`' && depth === 0) break;
      if (c === '$' && src[j + 1] === '{') depth++;
      else if (c === '}' && depth > 0) depth--;
    }
    out.push({ body: src.slice(i + 1, j), start: i + 1 });
  }
  return out;
}

/** Find ${…} expressions (balanced braces) inside a template body. */
function interps(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let depth = 1, j = i + 2;
      for (; j < body.length && depth; j++) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; }
      out.push({ expr: body.slice(i + 2, j - 1), at: i });
      i = j - 1;
    }
  }
  return out;
}

const files = globSync('**/*.js', { cwd: DIR }).map((f) => resolve(DIR, f));
const findings = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const t of templates(src)) {
    for (const it of interps(t.body)) {
      if (USER_DATA.test(it.expr) && !SAFE_CALL.test(it.expr)) {
        const line = src.slice(0, t.start + it.at).split('\n').length;
        findings.push({ file: relative(ROOT, file), line, expr: it.expr.trim().replace(/\s+/g, ' ').slice(0, 80) });
      }
    }
  }
}

if (findings.length === 0) {
  console.log('lint-innerhtml-esc: clean — every user-data innerHTML interpolation is escaped.');
  process.exit(0);
}
console.error(`lint-innerhtml-esc: ${findings.length} unescaped user-data interpolation(s) in innerHTML:\n`);
for (const f of findings) console.error(`  ${f.file}:${f.line}  \${${f.expr}}  — wrap in esc()`);
console.error('\nUser-controlled text in innerHTML must go through esc() to prevent XSS.');
process.exit(1);
