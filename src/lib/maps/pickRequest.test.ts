import { setMapPresenter, requestMapPick, sanitizeInitial, sanitizePlace } from './pickRequest';

afterEach(() => setMapPresenter(null));

test('with no picker mounted the request fails plainly instead of hanging', async () => {
  await expect(requestMapPick(undefined)).rejects.toThrow('map-unavailable');
});

test('only one map at a time: a second request while one is open is refused', async () => {
  let finish: (v: unknown) => void = () => {};
  setMapPresenter(() => new Promise((r) => { finish = r; }));
  const first = requestMapPick(undefined);
  await expect(requestMapPick(undefined)).rejects.toThrow('map-busy');
  finish(null);
  await expect(first).resolves.toBeNull();
  // and once it closed, the next one opens
  setMapPresenter(async () => ({ name: 'Gym', address: '', lat: 1, lng: 2, radius_m: 150 }));
  await expect(requestMapPick(undefined)).resolves.toMatchObject({ name: 'Gym' });
});

test('the initial place from the page is checked before the map sees it', () => {
  expect(sanitizeInitial({ lat: 28.6, lng: -81.2, radius_m: 137, name: '  Weight room ' }))
    .toEqual({ lat: 28.6, lng: -81.2, radius_m: 125, name: 'Weight room' });
  expect(sanitizeInitial({ lat: 'x', lng: 2 })).toBeNull();
  expect(sanitizeInitial({ lat: 91, lng: 2 })).toBeNull();
  expect(sanitizeInitial(null)).toBeNull();
  expect(sanitizeInitial({ lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2, radius_m: 150, name: '' });
});

test('a saved place always has a name, a legal radius and sane coordinates', () => {
  expect(sanitizePlace({ name: ' Field 2 ', address: 'Orlando', lat: 28.60241234, lng: -81.2001119, radius_m: 5000 }))
    .toEqual({ name: 'Field 2', address: 'Orlando', lat: 28.602412, lng: -81.200112, radius_m: 1000 });
  expect(sanitizePlace({ name: '   ', address: '', lat: 1, lng: 2, radius_m: 150 })).toBeNull();
  expect(sanitizePlace({ name: 'x', address: '', lat: Number.NaN, lng: 2, radius_m: 150 })).toBeNull();
  expect(sanitizePlace(null)).toBeNull();
});
