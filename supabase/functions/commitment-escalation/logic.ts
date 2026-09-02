// supabase/functions/commitment-escalation/logic.ts
// Pure copy for the escalation rungs. Factual, no guilt, no em dash.
// ZERO framework imports: loaded by both Deno (edge) and jest (babel).

/** The coach "who's up" digest (L3). */
export function digestBody(title: string, total: number, notUp: string[]): string {
  const up = total - notUp.length;
  if (notUp.length === 0) return `${title}: ${up}/${total} up. Everyone answered.`;
  const shown = notUp.slice(0, 5);
  const extra = notUp.length - shown.length;
  const names = extra > 0 ? `${shown.join(', ')} and ${extra} more` : shown.join(', ');
  return `${title}: ${up}/${total} up. ${notUp.length} didn't answer: ${names}.`;
}

/** The athlete's post-deadline push (L2). Wake-Up Roll Call (0211) says what happened and who
 *  can see it, in OnStandard's voice; every other type keeps its pre-0211 line. */
export function breakthroughCopy(type: string | null | undefined, title: string): { title: string; body: string } {
  if (type === 'morning_roll_call') {
    return { title: "You're late", body: `You haven't answered ${title}. Your coach can see your status.` };
  }
  return { title, body: 'The window is closing. Answer now.' };
}

/** The button on the late push. A roll call is still answerable until it closes, so it carries a
 *  "Check in now" rather than the on-time label; the device registers this label at launch. */
export const LATE_ACTION_LABEL = 'Check in now';
