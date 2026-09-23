/* One MAP_PICK at a time, between the bridge (which has no React state) and ProtoApp (which
   renders the picker). ProtoApp registers a presenter while it is mounted; the bridge asks it for
   a place and hands the answer back to the page. Pure: no React Native imports, so the bridge's
   tests exercise it for real. Nothing here logs, and nothing ever logs a coordinate. */
import { clampRadius, DEFAULT_RADIUS } from './radius';

/** What the coach saved. `address` is the best the reverse geocoder could do, or ''. */
export type Place = { name: string; address: string; lat: number; lng: number; radius_m: number };
/** Where the map opens when the coach is editing a place they already set. */
export type PickInitial = { lat: number; lng: number; radius_m: number; name: string };

type Presenter = (initial: PickInitial | null) => Promise<unknown>;

let presenter: Presenter | null = null;
let busy = false;

export function setMapPresenter(p: Presenter | null): void {
  presenter = p;
  if (!p) busy = false;
}

const NAME_MAX = 60;
const isLat = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const isLng = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** 6 decimals is ~0.1 m: more than the bubble needs, and no false precision in the database. */
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function sanitizeInitial(raw: unknown): PickInitial | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isLat(r.lat) || !isLng(r.lng)) return null;
  const radius = typeof r.radius_m === 'number' ? clampRadius(r.radius_m) : DEFAULT_RADIUS;
  return { lat: r.lat, lng: r.lng, radius_m: radius, name: text(r.name, NAME_MAX) };
}

export function sanitizePlace(raw: unknown): Place | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = text(r.name, NAME_MAX);
  if (!name || !isLat(r.lat) || !isLng(r.lng)) return null;
  return {
    name,
    address: text(r.address, 200),
    lat: round6(r.lat),
    lng: round6(r.lng),
    radius_m: clampRadius(typeof r.radius_m === 'number' ? r.radius_m : DEFAULT_RADIUS),
  };
}

/** Open the picker and wait for the coach. Resolves the place, or null on Cancel. Rejects with
 *  'map-unavailable' when no picker is mounted and 'map-busy' when one is already open, so the
 *  page never waits on a map that is not coming. */
export async function requestMapPick(rawInitial: unknown): Promise<Place | null> {
  if (!presenter) throw new Error('map-unavailable');
  if (busy) throw new Error('map-busy');
  busy = true;
  try {
    return sanitizePlace(await presenter(sanitizeInitial(rawInitial)));
  } finally {
    busy = false;
  }
}
