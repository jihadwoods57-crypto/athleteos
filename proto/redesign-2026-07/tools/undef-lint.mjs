// Did somebody forget the import? (2026-09-07)
//
// The proto has no bundler, so a call to a name that was never imported is not a build error —
// it is a ReferenceError at CLICK time, on one screen, in production. `connected-standards.js`
// shipped `countAttrs(...)` for however long with the function sitting un-exported in
// `standards-card.js`: the detail screen rendered blank and every other gate stayed green.
// verify:zip proves each import RESOLVES; nothing proved that each USE was imported.
//
// This is deliberately the narrowest rule that catches that bug with no false positives:
//
//   flag a bare identifier that (a) is used in a value position in this module, (b) is not
//   bound ANYWHERE in this module, and (c) IS a module-scope name in some other proto module.
//
// (b) is the over-approximation that makes it safe: a name bound in any unrelated function in
// the same file suppresses the report. That trades some recall for a zero-noise gate, which is
// the only kind worth putting in verify. (c) is what keeps it off globals without needing an
// exhaustive list of them — the signal is "this symbol exists next door and you didn't import
// it", which is the mistake being made.
//
// Run: node proto/redesign-2026-07/tools/undef-lint.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import * as walk from 'acorn-walk';

const PROTO = fileURLToPath(new URL('..', import.meta.url));
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const JS_DIR = join(PROTO, 'js');

function walkFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, acc);
    else if (/\.m?js$/i.test(name)) acc.push(full);
  }
  return acc;
}

/** Every name a binding pattern introduces: `a`, `{ b, c: d }`, `[e, ...f]`, `g = 1`. */
function bindingNames(node, out = []) {
  if (!node) return out;
  switch (node.type) {
    case 'Identifier': out.push(node.name); break;
    case 'ObjectPattern': for (const p of node.properties) bindingNames(p.type === 'RestElement' ? p.argument : p.value, out); break;
    case 'ArrayPattern': for (const el of node.elements) bindingNames(el, out); break;
    case 'AssignmentPattern': bindingNames(node.left, out); break;
    case 'RestElement': bindingNames(node.argument, out); break;
    default: break;
  }
  return out;
}

/** An identifier that names a property, a label, or an import/export clause is not a reference. */
function isValueRef(node, parent) {
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression': return !(parent.property === node && !parent.computed);
    case 'Property': return !(parent.key === node && !parent.computed);
    case 'PropertyDefinition':
    case 'MethodDefinition': return !(parent.key === node && !parent.computed);
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportSpecifier': return false;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement': return false;
    default: return true;
  }
}

const files = walkFiles(JS_DIR);
const info = new Map();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    console.error(`undef-lint: ${relative(ROOT, file)} does not parse — ${String(e.message).split('\n')[0]}`);
    process.exit(1);
  }

  const bound = new Set();
  const moduleScope = new Set();

  // Module-scope names: what another file could legitimately have meant to import.
  for (const stmt of ast.body) {
    if (stmt.type === 'ImportDeclaration') for (const s of stmt.specifiers) bound.add(s.local.name);
    const d = stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration' ? stmt.declaration : stmt;
    if (!d) continue;
    if (d.type === 'VariableDeclaration') for (const dec of d.declarations) for (const n of bindingNames(dec.id)) moduleScope.add(n);
    else if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) moduleScope.add(d.id.name);
  }
  for (const n of moduleScope) bound.add(n);

  // Every OTHER binding in the file, at any depth. Over-broad on purpose (see the header).
  walk.full(ast, (node) => {
    switch (node.type) {
      case 'VariableDeclarator': for (const n of bindingNames(node.id)) bound.add(n); break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) bound.add(node.id.name);
        for (const p of node.params) for (const n of bindingNames(p)) bound.add(n);
        break;
      case 'ClassDeclaration':
      case 'ClassExpression': if (node.id) bound.add(node.id.name); break;
      case 'CatchClause': for (const n of bindingNames(node.param)) bound.add(n); break;
      default: break;
    }
  });

  const used = new Map();
  walk.ancestor(ast, {
    Identifier(node, _state, ancestors) {
      const parent = ancestors[ancestors.length - 2];
      if (!isValueRef(node, parent)) return;
      if (!used.has(node.name)) used.set(node.name, node.loc.start.line);
    },
  });

  info.set(file, { bound, moduleScope, used });
}

// A module-scope name -> the files that define it. Test suites are excluded: nothing imports
// FROM a .test.mjs, so a fixture there sharing a name with a browser global (`CSS`) would
// otherwise make every real use of that global look like a missing import.
const definedIn = new Map();
for (const [file, { moduleScope }] of info) {
  if (/\.test\.m?js$/i.test(file)) continue;
  for (const name of moduleScope) {
    if (!definedIn.has(name)) definedIn.set(name, []);
    definedIn.get(name).push(file);
  }
}

const failures = [];
for (const [file, { bound, used }] of info) {
  for (const [name, line] of used) {
    if (bound.has(name)) continue;
    const homes = (definedIn.get(name) || []).filter((f) => f !== file);
    if (!homes.length) continue;
    failures.push(
      `${relative(ROOT, file)}:${line}  ${name} is used here but never imported or declared — ` +
      `it is defined in ${homes.map((f) => relative(ROOT, f)).join(', ')}`,
    );
  }
}

if (failures.length) {
  console.error(`undef-lint: ${failures.length} identifier${failures.length === 1 ? '' : 's'} used without an import\n`);
  for (const f of failures) console.error('  ' + f);
  console.error('\nEach one of these throws a ReferenceError the moment its screen renders.');
  process.exit(1);
}

console.log(`undef-lint: clean — ${files.length} modules, no identifier used without an import.`);
