// supabase/functions/roll-call-ack/logic.ts
// Pure status mapping for the roll-call-ack edge fn. ZERO framework imports on purpose: loaded
// by both Deno (edge) and jest (babel) — same rule tested from one implementation.
export type AckFailure = 'malformed' | 'bad_sig' | 'expired' | 'flag_off' | 'no_row';

export function httpStatusFor(reason: AckFailure): number {
  switch (reason) {
    case 'malformed':
    case 'bad_sig': return 401;
    case 'expired': return 410;
    case 'flag_off': return 403;
    case 'no_row': return 404;
  }
}
