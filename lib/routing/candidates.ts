import "server-only";

import { BROUTER_REQUEST_GAP_MS } from "@/lib/brouter/constants";
import type { GenerateRequest, Position3, RouteCandidate } from "@/lib/ors/schema";
import {
  RoutingError,
  type NetworkPreference,
  type RouteResult,
  type RoutingAdapter,
} from "./adapter";
import {
  CANDIDATE_COUNT,
  DISTANCE_TOLERANCE,
  DURATION_CORRECTION_THRESHOLD,
  HM_SCORE_FLOOR,
  RELAXED_TOLERANCE,
  RESULT_COUNT,
  RETRY_CANDIDATE_COUNT,
  SCORE_WEIGHTS,
  TARGET_HM_PER_KM,
  type Profile,
} from "./constants";
import { routingEngine } from "./engine";
import { distanceFromDurationKm, estimateDurationHours } from "./estimate";
import { boundsOf, compactness } from "./geo";
import { loopWaypoints } from "./loop";

/** Unter diesem Wert ist es keine Runde, sondern eine Strecke hin und zurück. */
const MIN_COMPACTNESS = 0.04;

/** Ab so wenigen Treffern bei "only" ist der Netz-Regler das Problem, nicht der Zufall. */
const NETWORK_FALLBACK_THRESHOLD = 2;

/* ------------------------------------------------------------------ *
 * Ereignisse, die der Route Handler als NDJSON weiterreicht
 * ------------------------------------------------------------------ */

/** Ein direkt ausführbarer Vorschlag — im UI ein Button, kein Fließtext. */
export type Suggestion = {
  kind: "networkPreference";
  value: NetworkPreference;
  label: string;
};

export type GenerateEvent =
  | { type: "progress"; done: number; total: number }
  | { type: "candidate"; candidate: RouteCandidate }
  | {
      type: "result";
      targetKm: number;
      targetHmPerKm: number;
      count: number;
      requests: number;
      notice?: string;
      suggestion?: Suggestion;
    }
  | { type: "error"; message: string; status: number; suggestion?: Suggestion };

/* ------------------------------------------------------------------ *
 * Scoring — Formel und Gewichte unverändert
 * ------------------------------------------------------------------ */

type Objective =
  | { kind: "distance"; targetKm: number }
  | { kind: "duration"; targetH: number; targetKm: number };

function primaryDeviation(objective: Objective, distanceKm: number, durationH: number): number {
  return objective.kind === "distance"
    ? Math.abs(distanceKm - objective.targetKm) / objective.targetKm
    : Math.abs(durationH - objective.targetH) / objective.targetH;
}

function scoreOf(
  objective: Objective,
  distanceKm: number,
  durationH: number,
  hmPerKm: number,
  targetHmPerKm: number,
): number {
  return (
    SCORE_WEIGHTS.distance * primaryDeviation(objective, distanceKm, durationH) +
    SCORE_WEIGHTS.elevation *
      (Math.abs(hmPerKm - targetHmPerKm) / Math.max(targetHmPerKm, HM_SCORE_FLOOR))
  );
}

/** Auf ~1 m runden — halbiert die Payload, sichtbar ist der Unterschied nicht. */
function trim(coordinates: ReadonlyArray<readonly number[]>): Position3[] {
  return coordinates.map((c) => [
    Math.round(c[0] * 1e5) / 1e5,
    Math.round(c[1] * 1e5) / 1e5,
    Math.round(c[2] ?? 0),
  ]);
}

type Raw = { seed: number; result: RouteResult };

function toCandidate(
  raw: Raw,
  profile: Profile,
  objective: Objective,
  targetHmPerKm: number,
): RouteCandidate {
  const distanceKm = raw.result.distanceM / 1000;
  const hmPerKm = raw.result.ascentM / Math.max(distanceKm, 0.001);
  const durationH = estimateDurationHours(distanceKm, raw.result.ascentM, profile);
  const coordinates = trim(raw.result.geometry);
  return {
    id: `s${raw.seed}`,
    distance: raw.result.distanceM,
    ascent: raw.result.ascentM,
    descent: raw.result.descentM,
    hmPerKm,
    durationH,
    score: scoreOf(objective, distanceKm, durationH, hmPerKm, targetHmPerKm),
    coordinates,
    bbox: boundsOf(coordinates),
  };
}

function viable(raw: Raw, objective: Objective, profile: Profile, tolerance: number): boolean {
  const distanceKm = raw.result.distanceM / 1000;
  const durationH = estimateDurationHours(distanceKm, raw.result.ascentM, profile);
  if (primaryDeviation(objective, distanceKm, durationH) > tolerance) return false;
  return compactness(trim(raw.result.geometry), raw.result.distanceM) >= MIN_COMPACTNESS;
}

/** Schlüssel zum Aussortieren fast identischer Runden. */
function dedupeKey(candidate: RouteCandidate): string {
  return [
    Math.round(candidate.distance / 500),
    Math.round(candidate.ascent / 25),
    ...candidate.bbox.map((v) => Math.round(v * 100)),
  ].join(":");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ *
 * Ablauf
 * ------------------------------------------------------------------ */

export async function* generateRoutes(
  request: GenerateRequest,
  signal?: AbortSignal,
): AsyncGenerator<GenerateEvent> {
  const { start, profile, terrain, target, nonce } = request;
  // Beim Rennrad ist der Regler ausgeblendet; die Stufe wird trotzdem hart auf
  // "ignore" gezogen, damit ein alter Client-Zustand nicht durchschlägt.
  const networkPreference: NetworkPreference =
    profile === "road" ? "ignore" : request.networkPreference;

  const engine: RoutingAdapter = routingEngine();
  const targetHmPerKm = TARGET_HM_PER_KM[terrain];

  let targetKm =
    target.mode === "distance"
      ? target.km
      : distanceFromDurationKm(target.minutes / 60, profile);

  const objectiveFor = (km: number): Objective =>
    target.mode === "distance"
      ? { kind: "distance", targetKm: km }
      : { kind: "duration", targetH: target.minutes / 60, targetKm: km };

  const pool: Raw[] = [];
  const emitted = new Set<string>();
  let requests = 0;
  let emittedCount = 0;

  const networkSuggestion: Suggestion | undefined =
    networkPreference === "only"
      ? { kind: "networkPreference", value: "prefer", label: "Beschilderte bevorzugen" }
      : undefined;

  /**
   * Läuft die Kandidaten eines Durchgangs sequenziell ab und meldet Fortschritt.
   * Gibt einen nicht wiederholbaren Fehler als Rückgabewert zurück (per `yield*`
   * abgreifbar) — über eine äußere Variable könnte TypeScript den Zustand nicht
   * durch die Closure verfolgen.
   */
  async function* runBatch(
    seeds: readonly number[],
    km: number,
    offset: number,
    total: number,
  ): AsyncGenerator<GenerateEvent, RoutingError | null> {
    for (const [index, seed] of seeds.entries()) {
      if (signal?.aborted) return null;
      // Nacheinander mit spürbarem Abstand — der Server ist ein Community-Dienst.
      if (requests > 0) await sleep(BROUTER_REQUEST_GAP_MS);
      if (signal?.aborted) return null;

      requests += 1;
      try {
        const result = await engine.route({
          waypoints: loopWaypoints(start, km * 1000, seed),
          profile,
          networkPreference,
        });
        pool.push({ seed, result });
      } catch (error) {
        if (error instanceof RoutingError && !error.retryable) return error;
        // Ein Seed, der nichts findet, ist normal — nächster Kandidat.
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[generate] seed ${seed} verworfen: ${reason}`);
      }

      yield { type: "progress", done: offset + index + 1, total };
      // Sofort rausgeben statt am Ende des Durchgangs: die erste Route liegt so
      // auf der Karte, während die restlichen noch gerechnet werden. Genau dafür
      // ist der Stream da. Die endgültige Reihenfolge macht der Client per Score.
      yield* flush(km, DISTANCE_TOLERANCE);
    }
    return null;
  }

  /** Neue, noch nicht gesendete Kandidaten aus dem Pool herausgeben. */
  function* flush(km: number, tolerance: number): Generator<GenerateEvent> {
    const objective = objectiveFor(km);
    const fresh = pool
      .filter((raw) => viable(raw, objective, profile, tolerance))
      .map((raw) => toCandidate(raw, profile, objective, targetHmPerKm))
      .sort((a, b) => a.score - b.score);

    for (const candidate of fresh) {
      const key = dedupeKey(candidate);
      if (emitted.has(key)) continue;
      emitted.add(key);
      emittedCount += 1;
      yield { type: "candidate", candidate };
    }
  }

  const firstSeeds = Array.from({ length: CANDIDATE_COUNT }, (_, i) => nonce * 1000 + i + 1);
  const totalPlanned = CANDIDATE_COUNT;

  const firstError = yield* runBatch(firstSeeds, targetKm, 0, totalPlanned);
  if (signal?.aborted) return;
  if (firstError) {
    yield { type: "error", message: firstError.userMessage, status: firstError.status };
    return;
  }

  yield* flush(targetKm, DISTANCE_TOLERANCE);

  /*
   * Genau ein Nachschlag. Im Dauer-Modus ist die Distanzkorrektur der nützlichere
   * Einsatz, im Distanz-Modus sind es schlicht neue Seeds.
   */
  if (target.mode === "duration") {
    const targetH = target.minutes / 60;
    const reference = pool
      .map((raw) => estimateDurationHours(raw.result.distanceM / 1000, raw.result.ascentM, profile))
      .sort((a, b) => Math.abs(a - targetH) - Math.abs(b - targetH))[0];

    if (reference && Math.abs(reference - targetH) / targetH > DURATION_CORRECTION_THRESHOLD) {
      targetKm = Math.min(220, Math.max(8, targetKm * (targetH / reference)));
      const seeds = Array.from(
        { length: RETRY_CANDIDATE_COUNT },
        (_, i) => nonce * 1000 + 100 + i + 1,
      );
      yield* runBatch(seeds, targetKm, totalPlanned, totalPlanned + RETRY_CANDIDATE_COUNT);
      if (signal?.aborted) return;
      yield* flush(targetKm, DISTANCE_TOLERANCE);
    }
  } else if (emittedCount < RESULT_COUNT) {
    const seeds = Array.from(
      { length: RETRY_CANDIDATE_COUNT },
      (_, i) => nonce * 1000 + 100 + i + 1,
    );
    yield* runBatch(seeds, targetKm, totalPlanned, totalPlanned + RETRY_CANDIDATE_COUNT);
    if (signal?.aborted) return;
    yield* flush(targetKm, DISTANCE_TOLERANCE);
  }

  // Reichen die strengen Treffer nicht, einmal die Toleranz lockern. Kostet keinen
  // weiteren Request; die Reihenfolge nach Score bleibt, der beste bleibt der beste.
  let relaxed = false;
  if (emittedCount < RESULT_COUNT) {
    const before = emittedCount;
    yield* flush(targetKm, RELAXED_TOLERANCE);
    relaxed = emittedCount > before;
  }

  if (emittedCount === 0) {
    yield {
      type: "error",
      status: 422,
      message:
        networkPreference === "only"
          ? "Auf beschilderten Radwegen ist hier keine passende Runde entstanden."
          : "Hier ist keine passende Runde entstanden. Probier einen anderen Startpunkt, eine andere Distanz oder eine flachere Stufe.",
      suggestion: networkSuggestion,
    };
    return;
  }

  let notice: string | undefined;
  let suggestion: Suggestion | undefined;

  if (networkPreference === "only" && emittedCount < NETWORK_FALLBACK_THRESHOLD) {
    notice =
      "Auf beschilderten Radwegen ist hier kaum etwas Passendes entstanden — das Radnetz gibt diese Runde nicht her.";
    suggestion = networkSuggestion;
  } else if (emittedCount < RESULT_COUNT) {
    notice =
      emittedCount === 1
        ? "Nur eine Runde hat gepasst — der Rest lag zu weit neben dem Ziel."
        : `Nur ${emittedCount} von ${RESULT_COUNT} Runden haben gepasst — der Rest lag zu weit neben dem Ziel.`;
  } else if (relaxed) {
    notice = "Runde 1 trifft das Ziel am besten; die Alternativen liegen etwas weiter daneben.";
  }

  yield {
    type: "result",
    targetKm,
    targetHmPerKm,
    count: emittedCount,
    requests,
    notice,
    suggestion,
  };
}
