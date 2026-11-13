// Pure rules behind the interactive tracking map: which token is usable,
// how far apart two points are and how the courier glides between them.

import type { TrackingPoint } from "./view.ts";

/** Only a public Maps token may reach the browser. */
export function publicMapToken(token: string | undefined) {
  return token?.startsWith("pk.") ? token : null;
}

const EARTH_RADIUS_METERS = 6_371_000;
const radians = (degrees: number) => degrees * Math.PI / 180;

export function distanceMeters(a: TrackingPoint, b: TrackingPoint) {
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Farther than this between two readings is a GPS gap, not a ride: jump instead of gliding. */
export const MAX_GLIDE_METERS = 2_000;

/**
 * How long the marker takes to reach a new reading. Gliding over the whole
 * refresh interval keeps the courier moving until the next reading arrives.
 */
export function glideMs(from: TrackingPoint | null, to: TrackingPoint, intervalMs: number, reducedMotion: boolean) {
  if (!from || reducedMotion) return 0;
  const meters = distanceMeters(from, to);
  return meters < 1 || meters > MAX_GLIDE_METERS ? 0 : intervalMs;
}

/** Point `progress` (0..1) of the way from `from` to `to`. */
export function pointAlong(from: TrackingPoint, to: TrackingPoint, progress: number): TrackingPoint {
  const t = Math.min(1, Math.max(0, progress));
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * t,
    longitude: from.longitude + (to.longitude - from.longitude) * t,
  };
}

/** South-west and north-east corners as [lng, lat], the order Mapbox expects. */
export function pointsBounds(points: TrackingPoint[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  const lats = points.map(point => point.latitude);
  const lngs = points.map(point => point.longitude);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}
