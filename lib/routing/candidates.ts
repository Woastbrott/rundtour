import "server-only";

import { directionsBudget } from "@/lib/ors/budget";
import { fetchRoundTrip, OrsError, runPool } from "@/lib/ors/client";
import type { GenerateRequest, GenerateResponse, LatLon, Position3, RouteCandidate } from "@/lib/ors/schema";
import {
  CANDIDATE_COUNT,
  DISTANCE_TOLERANCE,
  DURATION_CORRECTION_THRESHOLD,
  HM_SCORE_FLOOR,
  ORS_CONCURRENCY,
  ORS_LENGTH_COMPENSATION,
  RELAXED_TOLERANCE,
  RESULT_COUNT,
  RETRY_CANDIDATE_COUNT,
  ROUND_TRIP_POINTS,
  SCORE_WEIGHTS,
  TARGET_HM_PER_KM,
  type Profile,
} from "./constants";
import { distanceFromDurationKm, estimateDurationHours } from "./estimate";
import { boundsOf, compactness } from "./geo";

/** Unter diesem Wert ist es keine Runde, sondern eine Strecke hin und zurück. */
const MIN_COMPACTNESS = 0.04;

type RawCandidate = {
  seed: number;
  distance: number;
  ascent: number;
  descent: number;
  coordinates: Position3[];
};

/** Seeds deterministisch aus dem Request ableiten: gleicher Request -> gleiche Runden. */
function seedsFor(nonce: number, batch: number, count: number): number[] {
  const base = nonce * 1000 + batch * 100;
  return Array.from({ length: count }, (_, i) => base + i + 1);
}

async function requestBatch(
  start: LatLon,
  profile: Profile,
  targetKm: number,
  seeds: readonly number[],
): Promise<{ candidates: RawCandidate[]; firstError?: OrsError }> {
  const lengthM = targetKm * 1000 * ORS_LENGTH_COMPENSATION;

  const results = await runPool(seeds, ORS_CONCURRENCY, async (seed) => {
    const points = ROUND_TRIP_POINTS[seed % ROUND_TRIP_POINTS.length];
    const route = await fetchRoundTrip({ start, profile, lengthM, points, seed });
    return { seed, ...route } satisfies RawCandidate;
  });

  const candidates: RawCandidate[] = [];
  let firstError: OrsError | undefined;
  for (const r of results) {
    if (r.ok) candidates.push(r.value);
    else if (!firstError && r.error instanceof OrsError) firstError = r.error;
  }
  return { candidates, firstError };
}

/**
 * Wonach ein Kandidat gemessen wird.
 *
 * Im Distanz-Modus ist das die Distanz — wie vorgegeben. Im Dauer-Modus messen wir
 * gegen die Dauer statt gegen die Ersatz-Zieldistanz: der Nutzer hat eine Zeit
 * genannt, und die Umrechnung Dauer->Distanz ist nur eine Hilfsgröße für den
 * ORS-Call. Über die Distanz zu filtern warf sonst genau die Kandidaten weg,
 * die die Zeit am besten trafen.
 */
type Objective =
  | { kind: "distance"; targetKm: number }
  | { kind: "duration"; targetH: number; targetKm: number };

/** Relative Abweichung vom Ziel — die Größe, die Filter und Score gemeinsam nutzen. */
function primaryDeviation(
  objective: Objective,
  distanceKm: number,
  durationH: number,
): number {
  return objective.kind === "distance"
    ? Math.abs(distanceKm - objective.targetKm) / objective.targetKm
    : Math.abs(durationH - objective.targetH) / objective.targetH;
}

function scoreOf(objective: Objective, distanceKm: number, durationH: number, hmPerKm: number, targetHmPerKm: number): number {
  return (
    SCORE_WEIGHTS.distance * primaryDeviation(objective, distanceKm, durationH) +
    SCORE_WEIGHTS.elevation *
      (Math.abs(hmPerKm - targetHmPerKm) / Math.max(targetHmPerKm, HM_SCORE_FLOOR))
  );
}

/** Auf ~1 m Genauigkeit runden — spart rund die Hälfte der Payload, sichtbar ist der Unterschied nicht. */
function trim(coordinates: readonly Position3[]): Position3[] {
  return coordinates.map(([lon, lat, ele]) => [
    Math.round(lon * 1e5) / 1e5,
    Math.round(lat * 1e5) / 1e5,
    Math.round(ele),
  ]);
}

function toCandidate(
  raw: RawCandidate,
  profile: Profile,
  objective: Objective,
  targetHmPerKm: number,
): RouteCandidate {
  const distanceKm = raw.distance / 1000;
  const hmPerKm = raw.ascent / Math.max(distanceKm, 0.001);
  const durationH = estimateDurationHours(distanceKm, raw.ascent, profile);
  const coordinates = trim(raw.coordinates);
  return {
    id: `s${raw.seed}`,
    distance: raw.distance,
    ascent: raw.ascent,
    descent: raw.descent,
    hmPerKm,
    durationH,
    score: scoreOf(objective, distanceKm, durationH, hmPerKm, targetHmPerKm),
    coordinates,
    bbox: boundsOf(coordinates),
  };
}

/** Fast identische Runden aussortieren — gleiche Länge, gleicher Anstieg, gleiche Ausdehnung. */
function dedupe(candidates: readonly RouteCandidate[]): RouteCandidate[] {
  const seen = new Set<string>();
  const out: RouteCandidate[] = [];
  for (const c of candidates) {
    const key = [
      Math.round(c.distance / 500),
      Math.round(c.ascent / 25),
      Math.round(c.bbox[0] * 100),
      Math.round(c.bbox[1] * 100),
      Math.round(c.bbox[2] * 100),
      Math.round(c.bbox[3] * 100),
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function viable(
  raw: RawCandidate,
  objective: Objective,
  profile: Profile,
  tolerance: number,
): boolean {
  const distanceKm = raw.distance / 1000;
  const durationH = estimateDurationHours(distanceKm, raw.ascent, profile);
  if (primaryDeviation(objective, distanceKm, durationH) > tolerance) return false;
  // Zweiter Filter neben der Toleranz: ORS liefert regelmäßig Nicht-Runden zurück.
  // Der gilt immer, auch in der gelockerten Runde — Unsinn bleibt Unsinn.
  return compactness(raw.coordinates, raw.distance) >= MIN_COMPACTNESS;
}

export async function generateRoutes(request: GenerateRequest): Promise<GenerateResponse> {
  const { start, profile, terrain, target, nonce } = request;
  const targetHmPerKm = TARGET_HM_PER_KM[terrain];

  let targetKm =
    target.mode === "distance"
      ? target.km
      : distanceFromDurationKm(target.minutes / 60, profile);

  const objectiveFor = (km: number): Objective =>
    target.mode === "distance"
      ? { kind: "distance", targetKm: km }
      : { kind: "duration", targetH: target.minutes / 60, targetKm: km };

  let requests = 0;
  let budgetLimited = false;
  const pool: RawCandidate[] = [];
  let lastError: OrsError | undefined;

  /** Fragt so viele Kandidaten an, wie das Minutenbudget noch hergibt. */
  const runBatch = async (batch: number, count: number, km: number): Promise<number> => {
    const allowed = Math.min(count, directionsBudget.available());
    // Merken, ob wir gedrosselt wurden — sonst sähe ein knappes Ergebnis später
    // wie ein Routing-Problem aus, obwohl es nur am Kontingent lag.
    if (allowed < count) budgetLimited = true;
    if (allowed <= 0) return 0;
    directionsBudget.consume(allowed);

    const seeds = seedsFor(nonce, batch, allowed);
    requests += seeds.length;
    const { candidates, firstError } = await requestBatch(start, profile, km, seeds);
    if (firstError) lastError = firstError;
    pool.push(...candidates);
    return allowed;
  };

  // Durchlauf 1
  if ((await runBatch(0, CANDIDATE_COUNT, targetKm)) === 0) {
    const seconds = Math.ceil(directionsBudget.msUntilFree() / 1000);
    throw new OrsError(
      `Zu viele Anfragen in kurzer Zeit. Noch etwa ${seconds} Sekunden warten, dann geht es weiter.`,
      429,
      "minute budget exhausted before first batch",
    );
  }

  // Wenn ORS jeden einzelnen Seed abgelehnt hat, ist der Startpunkt das Problem — nicht der Filter.
  if (pool.length === 0) {
    throw (
      lastError ??
      new OrsError(
        "Von diesem Startpunkt aus kam keine einzige Runde zurück. Anderen Startpunkt probieren.",
        422,
      )
    );
  }

  /*
   * Genau ein Nachschlag, und zwar der nützlichere von beiden:
   * Im Dauer-Modus ist das die Distanzkorrektur (unten), im Distanz-Modus sind es
   * schlicht neue Seeds. Beides zusammen wären 20 ORS-Calls pro Klick — damit
   * reißt schon der zweite Klick das Minutenlimit.
   */
  if (
    target.mode === "distance" &&
    pool.filter((c) => viable(c, objectiveFor(targetKm), profile, DISTANCE_TOLERANCE)).length <
      RESULT_COUNT
  ) {
    await runBatch(1, RETRY_CANDIDATE_COUNT, targetKm);
  }

  const buildList = (km: number, tolerance = DISTANCE_TOLERANCE): RouteCandidate[] => {
    const objective = objectiveFor(km);
    return dedupe(
      pool
        .filter((c) => viable(c, objective, profile, tolerance))
        .map((c) => toCandidate(c, profile, objective, targetHmPerKm))
        .sort((a, b) => a.score - b.score),
    );
  };

  let list = buildList(targetKm);

  /*
   * Dauer-Modus: einmal nachkorrigieren, wenn die geschätzte Fahrzeit des besten
   * Kandidaten mehr als 15 % neben dem Ziel liegt. Hauptursache sind die Höhenmeter —
   * die kennen wir erst nach dem Routing.
   */
  if (target.mode === "duration") {
    const targetH = target.minutes / 60;

    // Referenz ist der beste Treffer; ist noch keiner durch den Filter gekommen,
    // nehmen wir den aus dem Rohpool, der zeitlich am nächsten dran ist — genau
    // dann ist die Korrektur am wichtigsten.
    const reference =
      list[0]?.durationH ??
      pool
        .map((c) => estimateDurationHours(c.distance / 1000, c.ascent, profile))
        .sort((a, b) => Math.abs(a - targetH) - Math.abs(b - targetH))[0];

    if (reference && Math.abs(reference - targetH) / targetH > DURATION_CORRECTION_THRESHOLD) {
      const correctedKm = clampKm(targetKm * (targetH / reference));
      await runBatch(2, RETRY_CANDIDATE_COUNT, correctedKm);
      targetKm = correctedKm;
      list = buildList(targetKm);
    }
  }

  if (list.length === 0) {
    // Erst prüfen, ob überhaupt genug Kandidaten geholt werden durften.
    if (budgetLimited) {
      const seconds = Math.max(Math.ceil(directionsBudget.msUntilFree() / 1000), 5);
      throw new OrsError(
        `Der Routing-Dienst lässt gerade nicht mehr Anfragen zu. In etwa ${seconds} Sekunden nochmal probieren.`,
        429,
        `budget-limited: only ${requests} of the planned requests ran, ${pool.length} raw routes`,
      );
    }
    throw new OrsError(
      "Hier ist keine passende Runde entstanden. Probier einen anderen Startpunkt, eine andere Distanz oder eine flachere Stufe.",
      422,
      `no viable candidate from ${pool.length} raw routes`,
    );
  }

  /*
   * Reichen die strengen Treffer nicht für drei Vorschläge, lockern wir die Toleranz
   * einmal auf. Das kostet keinen weiteren ORS-Call, und die Reihenfolge stimmt weiter:
   * sortiert wird nach Score, der beste Vorschlag bleibt also derselbe. Die zusätzlichen
   * Runden sind Alternativen, keine besseren Treffer — deshalb steht das auch dran.
   */
  let relaxed = false;
  if (list.length < RESULT_COUNT) {
    const wider = buildList(targetKm, RELAXED_TOLERANCE);
    if (wider.length > list.length) {
      relaxed = true;
      list = wider;
    }
  }

  const candidates = list.slice(0, RESULT_COUNT);

  let notice: string | undefined;
  if (candidates.length < RESULT_COUNT) {
    notice =
      candidates.length === 1
        ? "Nur eine Runde hat gepasst — der Rest lag zu weit neben dem Ziel."
        : `Nur ${candidates.length} von ${RESULT_COUNT} Runden haben gepasst — der Rest lag zu weit neben dem Ziel.`;
  } else if (relaxed) {
    notice = "Runde 1 trifft das Ziel am besten; die Alternativen liegen etwas weiter daneben.";
  }

  return { candidates, targetKm, targetHmPerKm, requests, notice };
}

function clampKm(km: number): number {
  return Math.min(220, Math.max(8, km));
}
