// supabase/functions/roll-call-ack/logic.ts
// Pure status mapping for the roll-call-ack edge fn. ZERO framework imports on purpose: loaded
// by both Deno (edge) and jest (babel) — same rule tested from one implementation.
//
// 'bad_kind' is a COACH code presented to the athlete ack endpoint (or the reverse). It is an
// authentication failure, not a routing mistake, so it wears 401 alongside bad_sig — the caller
// holds a real, correctly-signed credential for a different door, and telling them apart in the
// response would be free reconnaissance.
export type AckFailure = 'malformed' | 'bad_sig' | 'bad_kind' | 'expired' | 'flag_off' | 'no_row' | 'db_error';

export function httpStatusFor(reason: AckFailure): number {
  switch (reason) {
    case 'malformed':
    case 'bad_kind':
    case 'bad_sig': return 401;
    case 'expired': return 410;
    case 'flag_off': return 403;
    case 'no_row': return 404;
    case 'db_error': return 500;
  }
}
