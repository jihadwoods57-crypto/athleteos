import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments } from './strip-comments.mjs';

const DASH = '—';

test('comments go, copy stays, line numbers hold', () => {
  const src = `// gone ${DASH} comment\nconst a = 'kept ${DASH} copy';\n/* block ${DASH}\n   more */ const b = 1;\n`;
  const out = stripComments(src);
  assert.ok(!out.includes('gone'));
  assert.ok(out.includes(`kept ${DASH} copy`));
  assert.equal(out.split('\n').length, src.split('\n').length);
});

test('a slash-star inside a string is NOT a comment (the image/* bug)', () => {
  const src = `const accept = 'image/*';\nconst copy = 'real ${DASH} copy';\n// trailing */ terminator in a comment\n`;
  const out = stripComments(src);
  assert.ok(out.includes('image/*'));
  assert.ok(out.includes(`real ${DASH} copy`), 'copy after the phantom open must survive');
});

test('regex literals with quotes and classes do not desync string tracking', () => {
  const src = `const re = /['"]/g;\n/* a comment ${DASH} exempt */\nconst s = 'copy ${DASH} counted';\n`;
  const out = stripComments(src);
  assert.ok(!out.includes('exempt'));
  assert.ok(out.includes(`copy ${DASH} counted`));
});

test('division is not eaten as a regex across lines', () => {
  const src = `const x = a / b;\nconst y = c / d;\n// comment ${DASH} exempt\nconst s = 'copy ${DASH} yes';\n`;
  const out = stripComments(src);
  assert.ok(!out.includes('exempt'));
  assert.ok(out.includes(`copy ${DASH} yes`));
});

test('nested templates and interpolations survive; comments after them still strip', () => {
  const src = 'const t = `outer ${cond ? `inner ' + DASH + ' kept` : \'\'} ${ { a: 1 }.a } tail ' + DASH + ' kept`;\n' + `// after ${DASH} exempt\nconst u = "also ${DASH} kept";\n`;
  const out = stripComments(src);
  assert.ok(out.includes(`inner ${DASH} kept`));
  assert.ok(out.includes(`tail ${DASH} kept`));
  assert.ok(!out.includes('exempt'));
  assert.ok(out.includes(`also ${DASH} kept`));
});

test('URL tails are not line comments', () => {
  const src = `const u = 'https://onstandard.app/v/x';\n`;
  assert.ok(stripComments(src).includes('https://onstandard.app/v/x'));
});
