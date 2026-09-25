// Tool syntax that leaked into a prose field (2026-09-25).
//
// The model writes a meal read as tool fields, and once it closed `analysis` and opened the next
// field INSIDE the string: "...plate then.</analysis>\n<parameter name="descriptionSignal">match".
// meal-opener strips every < and >, so Nia's message read "then./analysis parameter
// name="descriptionSignal"match" to the athlete. Anything from the first leaked marker on is the
// model talking to the tool, not to the athlete, so it is cut, along with the dangling close tag.

// Markers that never occur in prose: a tool tag (raw or bracket-stripped), `parameter name="`, or a
// closing tag immediately followed by another tag.
const LEAK = /<\s*\/?\s*(?:parameter|invoke|antml:[\w-]+|function_calls|function_results|tool_use|tool_result)\b|\bparameter\s+name\s*=\s*["']|<\/\s*[A-Za-z_][\w-]*\s*>\s*</i;

/** The prose before the first leaked tool marker, or the string unchanged when there is none. */
export function scrubToolLeak(s: string): string {
  if (typeof s !== 'string' || !s) return s;
  const m = LEAK.exec(s);
  if (!m) return s;
  return s.slice(0, m.index)
    // the field's own close tag, just before the marker: "</analysis>", "</analysis" or "/analysis"
    .replace(/<?\s*\/\s*[A-Za-z_][\w-]*\s*>?\s*$/, '')
    .replace(/[<>\s]+$/, '');
}

/** An enum value the model wrote for `field` inside a leak, when it is one of `allowed`. */
export function leakedEnum(s: unknown, field: string, allowed: readonly string[]): string | null {
  if (typeof s !== 'string' || !s) return null;
  const re = new RegExp(`name\\s*=\\s*["']${field}["']\\s*>?\\s*([A-Za-z_]+)`, 'i');
  const v = re.exec(s)?.[1];
  return v && allowed.includes(v) ? v : null;
}
