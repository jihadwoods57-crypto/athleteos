// supabase/functions/roll-call-ack/logic.test.ts
import { httpStatusFor } from './logic';

describe('httpStatusFor', () => {
  it('malformed/bad_sig -> 401', () => {
    expect(httpStatusFor('malformed')).toBe(401);
    expect(httpStatusFor('bad_sig')).toBe(401);
  });
  it('expired -> 410', () => {
    expect(httpStatusFor('expired')).toBe(410);
  });
  it('flag_off -> 403', () => {
    expect(httpStatusFor('flag_off')).toBe(403);
  });
  it('no_row -> 404', () => {
    expect(httpStatusFor('no_row')).toBe(404);
  });
  it('db_error -> 500', () => {
    expect(httpStatusFor('db_error')).toBe(500);
  });
});
