import { formatAddress } from './address';

const blank = { name: null, streetNumber: null, street: null, city: null, region: null, formattedAddress: null };

test('a named place reads as its name and town', () => {
  expect(formatAddress({ ...blank, name: 'FBC Mortgage Stadium', street: 'Knights Plaza', city: 'Orlando', region: 'FL' }))
    .toBe('FBC Mortgage Stadium, Orlando');
});
test('a street address reads as number, street and town, with no repeats', () => {
  expect(formatAddress({ ...blank, name: '4000 Central Florida Blvd', streetNumber: '4000', street: 'Central Florida Blvd', city: 'Orlando' }))
    .toBe('4000 Central Florida Blvd, Orlando');
  expect(formatAddress({ ...blank, streetNumber: '12', street: 'Main St', city: 'Oviedo' })).toBe('12 Main St, Oviedo');
});
test('falls back to whatever the geocoder had, then to nothing', () => {
  expect(formatAddress({ ...blank, formattedAddress: '1 Loop Rd, Winter Park, FL' })).toBe('1 Loop Rd, Winter Park, FL');
  expect(formatAddress({ ...blank, region: 'Florida' })).toBe('Florida');
  expect(formatAddress(blank)).toBe('');
  expect(formatAddress(null)).toBe('');
});

import { suggestName } from './address';
test('a searched landmark offers its own name; a street address offers nothing', () => {
  expect(suggestName('FBC Mortgage Stadium, Orlando')).toBe('FBC Mortgage Stadium');
  expect(suggestName('4000 Central Florida Blvd, Orlando')).toBe('');
  expect(suggestName('')).toBe('');
});
