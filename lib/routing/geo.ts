import type { Position3 } from "@/lib/ors/schema";

const EARTH_R = 6_371_008.8;

export function haversineM(a: readonly number[], b: readonly number[]): number {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Zielpunkt aus Start, Peilung und Distanz (Großkreis).
 * Basis für die Rundtour-Wegpunkte, seit BRouter kein round_trip kennt.
 */
export function destination(
  lon: number,
  lat: number,
  distanceM: number,
  bearingRad: number,
): [number, number] {
  const δ = distanceM / EARTH_R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;

  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearingRad);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * sinφ2,
    );

  return [(((λ2 * 180) / Math.PI + 540) % 360) - 180, (φ2 * 180) / Math.PI];
}

export function boundsOf(coordinates: readonly Position3[]): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coordinates) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Kompaktheit der Schleife: 4πA / U².
 * Kreis = 1, echte Runde ~0.15–0.5, eine Hin-und-zurück-Strecke auf derselben Straße
 * geht gegen 0, weil die eingeschlossene Fläche verschwindet. Genau das wollen wir
 * erkennen — ORS liefert solche Nicht-Runden regelmäßig.
 */
export function compactness(coordinates: readonly Position3[], perimeterM: number): number {
  if (coordinates.length < 3 || perimeterM <= 0) return 0;

  // Lokale äquidistante Projektion um die mittlere Breite — auf Tourlänge genau genug.
  const lat0 = (coordinates[0][1] * Math.PI) / 180;
  const mx = 111_320 * Math.cos(lat0);
  const my = 110_540;

  let twiceArea = 0;
  for (let i = 0; i < coordinates.length; i++) {
    const p = coordinates[i];
    const q = coordinates[(i + 1) % coordinates.length];
    twiceArea += p[0] * mx * (q[1] * my) - q[0] * mx * (p[1] * my);
  }
  const area = Math.abs(twiceArea) / 2;
  return (4 * Math.PI * area) / perimeterM ** 2;
}

/** Kumulierte Distanz in km entlang der Linie — Basis für das Höhenprofil. */
export function cumulativeKm(coordinates: readonly Position3[]): number[] {
  const out = new Array<number>(coordinates.length);
  let sum = 0;
  out[0] = 0;
  for (let i = 1; i < coordinates.length; i++) {
    sum += haversineM(coordinates[i - 1], coordinates[i]);
    out[i] = sum / 1000;
  }
  return out;
}
