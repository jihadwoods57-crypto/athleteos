/* The ONE comment stripper for copy tooling (copy-lint, em-dash-ratchet).
 *
 * A scanner, not a regex (tool-debt fix 2026-08-20). The old regex pass could not tell a string
 * from a comment, so any string containing a slash-star — a mime type like image/png with a
 * wildcard, a glob — opened a phantom block comment that blanked every line of real copy until
 * the file's next comment terminator. For a ratchet that means silent UNDERCOUNTING: the gate
 * wasn't guarding what it claimed.
 *
 * What it understands, because each of these desynced a draft of it against real proto source:
 *   - '…' / "…" strings with escapes
 *   - template literals INCLUDING ${…} interpolations, nested templates inside them, and
 *     object literals inside those (brace depth per interpolation, saved on a stack)
 *   - regex literals (heuristic: a slash after an operator/opener starts one; a newline aborts
 *     back to code, since a real regex literal cannot span lines — bounds any division misread
 *     to a single line)
 *   - `//` preceded by ':' or '/' is a URL tail, not a comment (same exemption as always)
 *
 * Comments become spaces, newlines survive, so line numbers in reports stay true.
 */
export function stripComments(src) {
  let out = '';
  let mode = null; // null(code) | '"' | "'" | '`' | 'line' | 'block' | 're' | 'reclass'
  let depth = 0;          // { } depth of the current interpolation's code
  const tplStack = [];    // saved depths of enclosing template interpolations
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (mode === null) {
      if (c === '/' && d === '/') {
        const prev = out[out.length - 1];
        if (prev === ':' || prev === '/') { out += c; continue; }
        mode = 'line'; i++; continue;
      }
      if (c === '/' && d === '*') { mode = 'block'; out += '  '; i++; continue; }
      if (c === '/') {
        const tail = out.replace(/\s+$/, '');
        const p = tail[tail.length - 1];
        if (p === undefined || '(,=:[!&|?{};+-*%~^<>'.includes(p)) { mode = 're'; out += c; continue; }
      }
      if (c === '"' || c === "'" || c === '`') { mode = c; out += c; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0 && tplStack.length) { mode = '`'; depth = tplStack.pop(); out += c; continue; }
        if (depth > 0) depth--;
      }
      out += c; continue;
    }
    if (mode === 're' || mode === 'reclass') {
      out += c;
      if (c === '\n') { mode = null; continue; }
      if (c === '\\') { out += d || ''; i++; continue; }
      if (mode === 're' && c === '[') { mode = 'reclass'; continue; }
      if (mode === 'reclass' && c === ']') { mode = 're'; continue; }
      if (mode === 're' && c === '/') mode = null;
      continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = null; out += c; } continue; }
    if (mode === 'block') {
      if (c === '*' && d === '/') { mode = null; out += '  '; i++; continue; }
      out += c === '\n' ? c : ' '; continue;
    }
    if (mode === '`') {
      if (c === '\\') { out += c + (d || ''); i++; continue; }
      if (c === '$' && d === '{') { tplStack.push(depth); depth = 0; mode = null; out += '${'; i++; continue; }
      if (c === '`') mode = null;
      out += c; continue;
    }
    // ' or " string
    if (c === '\\') { out += c + (d || ''); i++; continue; }
    if (c === mode) mode = null;
    out += c;
  }
  return out;
}
