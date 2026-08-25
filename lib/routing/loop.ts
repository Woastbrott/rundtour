import { destination } from "./geo";
import { LOOP_JITTER_MIN, LOOP_JITTER_SPAN, LOOP_POINTS, LOOP_RADIUS_FACTOR } from "./constants";

export type LngLat = [number, number];

/**
 * Deterministischer PRNG (mulberry32).
 * Kein Math.random: gleicher Seed muss dieselbe Runde ergeben, sonst ist weder
 * der Cache sinnvoll noch ein Ergebnis reproduzierbar.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wegpunkte für eine Rundtour: ein gejitterter Ring um den Start.
 *
 * BRouter kennt kein round_trip, also erzeugen wir die Zwischenziele selbst und
 * lassen die Engine sie verbinden. Der Ring wird bewusst unregelmäßig — ohne
 * Jitter käme ein Kreis heraus, und Kreise sind langweilig und selten fahrbar.
 *
 * Die Punkte landen oft im Nirgendwo; BRouter snappt auf den nächsten passenden
 * Weg, das ist gewollt.
 */
export function loopWaypoints(
  start: { lat: number; lon: number },
  targetDistanceM: number,
  seed: number,
): LngLat[] {
  const random = mulberry32(seed);

  // Umfang -> Radius, plus Zuschlag, weil Straßen keine Kreisbögen sind.
  const baseRadius = (targetDistanceM / (2 * Math.PI)) * LOOP_RADIUS_FACTOR;
  const startBearing = random() * 2 * Math.PI;

  const points: LngLat[] = [];
  for (let i = 0; i < LOOP_POINTS; i++) {
    const bearing = startBearing + i * ((2 * Math.PI) / LOOP_POINTS);
    const radius = baseRadius * (LOOP_JITTER_MIN + random() * LOOP_JITTER_SPAN);
    points.push(destination(start.lon, start.lat, radius, bearing));
  }

  // Erster und letzter Punkt identisch — das macht die Runde.
  const startPoint: LngLat = [start.lon, start.lat];
  return [startPoint, ...points, startPoint];
}
