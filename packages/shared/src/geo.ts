import { LIMITS, PROXIMITY_THRESHOLDS_M, type ProximityBucket } from './constants.js';

/** Round coordinates to ~110 m before they ever leave the device. */
export function coarsen(lat: number, lng: number): { lat: number; lng: number } {
  const f = 10 ** LIMITS.locationPrecisionDecimals;
  return { lat: Math.round(lat * f) / f, lng: Math.round(lng * f) / f };
}

export function bucketForDistanceM(d: number | null | undefined): ProximityBucket {
  if (d == null || !Number.isFinite(d)) return 'unknown';
  if (d <= PROXIMITY_THRESHOLDS_M.very_nearby) return 'very_nearby';
  if (d <= PROXIMITY_THRESHOLDS_M.nearby) return 'nearby';
  if (d <= PROXIMITY_THRESHOLDS_M.short_walk) return 'short_walk';
  return 'farther';
}

/** Haversine distance in meters (client-side previews only; matching uses PostGIS). */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
