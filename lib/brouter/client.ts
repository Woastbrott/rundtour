import "server-only";

import { z } from "zod";

import {
  RoutingError,
  type RouteRequest,
  type RouteResult,
  type RoutingAdapter,
} from "@/lib/routing/adapter";
import { BROUTER_BASE, BROUTER_TIMEOUT_MS, BROUTER_USER_AGENT } from "./constants";
import { invalidateProfile, resolveProfile } from "./profiles";

/**
 * BRouter-GeoJSON. Die Zahlenfelder kommen als Strings — deshalb überall
 * `coerce`, nicht `z.number()`.
 */
const brouterSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(z.array(z.number()).min(2)).min(2),
        }),
        properties: z.object({
          "track-length": z.coerce.number(),
          "filtered ascend": z.coerce.number().optional(),
        }),
      }),
    )
    .min(1),
});

function translate(status: number, body: string): RoutingError {
  const text = body.trim();

  // Der öffentliche Server killt zu aufwendige Suchen nach ein paar Sekunden.
  if (/thread-priority-watchdog|timeout/i.test(text)) {
    return new RoutingError(
      "Diese Runde war dem Routing-Dienst zu aufwendig.",
      504,
      { internal: `brouter watchdog: ${text.slice(0, 160)}`, retryable: true },
    );
  }
  if (/position not mapped|no track found|not found/i.test(text)) {
    return new RoutingError(
      "Von hier aus führt kein befahrbarer Weg zum nächsten Zwischenziel.",
      422,
      { internal: `brouter unroutable: ${text.slice(0, 160)}`, retryable: true },
    );
  }
  if (status === 429 || status === 503) {
    return new RoutingError(
      "Der Routing-Dienst ist gerade überlastet. In einer Minute nochmal probieren.",
      429,
      { internal: `brouter ${status}: ${text.slice(0, 160)}` },
    );
  }
  // 500 mit leerem Body ist BRouters Standardantwort auf so ziemlich jeden
  // Eingabefehler — inklusive "Profil kenne ich nicht". Nur hier lohnt ein
  // Neu-Upload des Profils; bei Timeout oder Überlast wäre er reine Zeitverschwendung.
  return new RoutingError(
    "Der Routing-Dienst konnte diese Runde nicht berechnen.",
    502,
    {
      internal: `brouter ${status}: ${text.slice(0, 160) || "(leerer Body)"}`,
      retryable: true,
      profileSuspect: status >= 500 && text.length === 0,
    },
  );
}

async function fetchTrack(lonlats: string, profileName: string): Promise<unknown> {
  const params = new URLSearchParams({
    lonlats,
    profile: profileName,
    alternativeidx: "0",
    format: "geojson",
  });

  let response: Response;
  try {
    response = await fetch(`${BROUTER_BASE}/brouter?${params.toString()}`, {
      headers: { "User-Agent": BROUTER_USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(BROUTER_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new RoutingError(
      timedOut
        ? "Der Routing-Dienst hat zu lange gebraucht."
        : "Der Routing-Dienst ist nicht erreichbar.",
      504,
      {
        internal: cause instanceof Error ? cause.message : String(cause),
        retryable: timedOut,
      },
    );
  }

  const text = await response.text();
  if (!response.ok || !text.trimStart().startsWith("{")) {
    throw translate(response.status, text);
  }
  return JSON.parse(text) as unknown;
}

export class BRouterAdapter implements RoutingAdapter {
  readonly name = "brouter";

  async route(req: RouteRequest): Promise<RouteResult> {
    const lonlats = req.waypoints
      .map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`)
      .join("|");

    let profileName = await resolveProfile(req.profile, req.networkPreference);

    let raw: unknown;
    try {
      raw = await fetchTrack(lonlats, profileName);
    } catch (error) {
      /*
       * Hochgeladene Profile können ablaufen — dann einmal neu hochladen und
       * erneut versuchen. Aber wirklich nur dann: bei einem Timeout hat der
       * zweite Versuch dieselbe Aussicht und verdoppelt nur die Wartezeit
       * (gemessen: 41 s statt 20 s für den ersten Kandidaten einer 150-km-Runde).
       */
      const worthRetrying =
        error instanceof RoutingError &&
        error.profileSuspect &&
        profileName.startsWith("custom_");
      if (!worthRetrying) throw error;

      invalidateProfile(req.profile, req.networkPreference);
      profileName = await resolveProfile(req.profile, req.networkPreference);
      raw = await fetchTrack(lonlats, profileName);
    }

    const parsed = brouterSchema.safeParse(raw);
    if (!parsed.success) {
      throw new RoutingError("Die Antwort des Routing-Dienstes war unbrauchbar.", 502, {
        internal: `schema mismatch: ${parsed.error.message.slice(0, 240)}`,
      });
    }

    const feature = parsed.data.features[0];
    const geometry = feature.geometry.coordinates.map(
      (c) => [c[0], c[1], c[2] ?? 0] as [number, number, number],
    );

    /*
     * BRouter liefert keinen Abstieg. Bei einer geschlossenen Runde ist er
     * zwangsläufig gleich dem Aufstieg — eigene Berechnung aus der Geometrie
     * wäre eine andere Größe (ungefiltert) und würde nicht zum Aufstieg passen.
     */
    const ascentM = feature.properties["filtered ascend"] ?? 0;

    return {
      geometry,
      distanceM: feature.properties["track-length"],
      ascentM,
      descentM: ascentM,
    };
  }
}
