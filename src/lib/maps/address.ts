/* One readable line for a reverse-geocoded point: "FBC Mortgage Stadium, Orlando" or
   "12 Main St, Oviedo". Shown under the place name and saved as the place's address. */
type Geo = {
  name?: string | null; streetNumber?: string | null; street?: string | null;
  city?: string | null; region?: string | null; formattedAddress?: string | null;
};

export function formatAddress(a: Geo | null | undefined): string {
  if (!a) return '';
  const street = [a.streetNumber, a.street].filter(Boolean).join(' ');
  const first = a.name || street;
  const parts = [first, a.city].filter((p): p is string => !!p && !!p.trim());
  if (parts.length) return [...new Set(parts)].join(', ');
  return (a.formattedAddress || a.region || '').trim();
}

/** A name to pre-fill after a search: the landmark's own name ("FBC Mortgage Stadium"), never a
 *  street address, which would make a poor name for a coach's team to read. The coach can edit it. */
export function suggestName(label: string): string {
  const first = (label.split(',')[0] || '').trim();
  return first && !/^\d/.test(first) ? first.slice(0, 60) : '';
}
