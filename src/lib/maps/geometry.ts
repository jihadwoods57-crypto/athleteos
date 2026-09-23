/* Screen <-> ground maths for the place picker's drag handle. Pure, and deliberately simple: at
   the zoom levels a coach draws a 100 m to 1 km bubble, the visible map is a few kilometres wide,
   so a flat projection of the region the map last reported is accurate to well under a point.
   The map reports its region only when a pan or zoom ENDS (expo-maps onCameraMove is .onEnd on
   iOS), which is why the picker hides the handle while a finger is on the map. */
import { clampRadius } from './radius';

export type LatLng = { lat: number; lng: number };
/** The visible map: its centre and span, as onCameraMove reports it. */
export type Region = LatLng & { latDelta: number; lngDelta: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

const METERS_PER_DEGREE = 111320;
/** Touch slop so the handle is never drawn half off the edge of the screen. */
export const EDGE = 22;

const cosLat = (lat: number) => Math.max(0.01, Math.cos((lat * Math.PI) / 180));

/** Ground metres covered by one screen point, measured across the map's width. */
export function metersPerPoint(region: Region, size: Size): number {
  if (!(size.width > 0) || !(region.lngDelta > 0)) return 0;
  return (region.lngDelta * METERS_PER_DEGREE * cosLat(region.lat)) / size.width;
}

export function toScreen(p: LatLng, region: Region, size: Size): Point {
  return {
    x: size.width / 2 + ((p.lng - region.lng) / region.lngDelta) * size.width,
    y: size.height / 2 - ((p.lat - region.lat) / region.latDelta) * size.height,
  };
}

/** The bubble's east edge on screen, wherever that is (null before the map reports a region). */
export function edgePoint(center: LatLng, radius: number, region: Region | null, size: Size): Point | null {
  if (!region) return null;
  const mpp = metersPerPoint(region, size);
  if (!(mpp > 0)) return null;
  const c = toScreen(center, region, size);
  return { x: c.x + radius / mpp, y: c.y };
}

/** Where the drag handle goes: the bubble's east edge. Null when that is off screen (or the map
 *  has not reported a region yet), in which case the slider is the only control. */
export function handlePoint(center: LatLng, radius: number, region: Region | null, size: Size): Point | null {
  const p = edgePoint(center, radius, region, size);
  if (!p) return null;
  const inside = p.x >= EDGE && p.x <= size.width - EDGE && p.y >= EDGE && p.y <= size.height - EDGE;
  return inside ? p : null;
}

/** The radius a finger at `finger` asks for, with the bubble's centre drawn at `centre`. */
export function radiusFromDrag(centre: Point, finger: Point, mpp: number): number {
  return clampRadius(Math.hypot(finger.x - centre.x, finger.y - centre.y) * mpp);
}

/** An expo-maps zoom level at which a bubble of `radius` metres fills `fill` of the map's width.
 *  expo-maps turns zoom into a span as 360 / 2^zoom degrees of longitude. */
export function zoomToFit(radius: number, lat: number, fill = 0.6): number {
  const widthMeters = (2 * radius) / fill;
  const lngDelta = widthMeters / (METERS_PER_DEGREE * cosLat(lat));
  return Math.log2(360 / lngDelta);
}
