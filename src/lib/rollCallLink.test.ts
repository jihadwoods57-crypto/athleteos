import { rollCallRouteFromUrl } from './rollCallLink';

describe('rollCallRouteFromUrl', () => {
  test('the widget body tap opens that morning’s team board', () => {
    expect(rollCallRouteFromUrl('onstandard://roll-call/a1b2c3d4-0000-4000-8000-000000000001'))
      .toBe('rollcall-board/a1b2c3d4-0000-4000-8000-000000000001');
    expect(rollCallRouteFromUrl('onstandard://rollcall-board/i1')).toBe('rollcall-board/i1');
    expect(rollCallRouteFromUrl('onstandard://roll-call/i1?x=1')).toBe('rollcall-board/i1');
  });
  test('no snapshot, other links and unsafe ids route nowhere', () => {
    expect(rollCallRouteFromUrl('onstandard://roll-call/')).toBeNull();
    expect(rollCallRouteFromUrl('onstandard://join?code=EAGLES24')).toBeNull();
    expect(rollCallRouteFromUrl('https://onstandard.app/roll-call/i1')).toBeNull();
    expect(rollCallRouteFromUrl("onstandard://roll-call/x';alert(1)")).toBeNull();
    expect(rollCallRouteFromUrl(null)).toBeNull();
  });
});
