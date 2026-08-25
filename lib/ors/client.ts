import "server-only";

import { geocodeBudget } from "./budget";
import { orsDirectionsSchema, orsErrorSchema, orsGeocodeSchema } from "./schema";
import type { GeocodeHit, LatLon, Position3 } from "./schema";
import { ORS_PROFILE, type Profile } from "@/lib/routing/constants";

const ORS_BASE = "https://api.openrouteservice.org";

/**
 * Fehler, dessen `userMessage` gefahrlos an den Client darf.
 * Alles Interne (ORS-Rohtext, Key, Stacktrace) bleibt in `cause` und damit serverseitig.
 */
export class OrsError extends Error {
  readonly status: number;
  readonly userMessage: string;

  constructor(userMessage: string, status: number, internal?: string) {
    super(internal ?? userMessage);
    this.name = "OrsError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

function apiKey(): string {
  const key = process.env.ORS_API_KEY;
  if (!key) {
    throw new OrsError(
      "Der Routing-Dienst ist nicht konfiguriert. ORS_API_KEY fehlt auf dem Server.",
      500,
      "ORS_API_KEY not set",
    );
  }
  return key;
}

/** ORS-Fehler in etwas übersetzen, das dem Nutzer sagt, was er tun kann. */
function translate(status: number, body: string): OrsError {
  let orsMessage = "";
  let orsCode: number | undefined;
  try {
    const parsed = orsErrorSchema.safeParse(JSON.parse(body));
    if (parsed.success) {
      const e = parsed.data.error;
      if (typeof e === "string") orsMessage = e;
      else {
        orsMessage = e.message ?? "";
        orsCode = e.code;
      }
    }
  } catch {
    // Kein JSON — dann bleibt orsMessage leer, der Rohtext geht in den internen Teil.
  }

  const internal = `ORS ${status}${orsCode ? ` code=${orsCode}` : ""}: ${orsMessage || body.slice(0, 300)}`;

  if (status === 401 || status === 403) {
    return new OrsError(
      "Der Routing-Dienst hat den Zugang abgelehnt — der API-Key ist ungültig oder abgelaufen.",
      502,
      internal,
    );
  }
  if (status === 429) {
    /*
     * ORS unterscheidet Minuten- und Tageslimit im 429 nicht und schickt weder
     * Retry-After noch Ratelimit-Header mit. Die Meldung deckt deshalb beides ab —
     * eine genauere Aussage wäre geraten.
     */
    return new OrsError(
      "Der Routing-Dienst bremst gerade — zu viele Anfragen. Eine Minute warten und nochmal probieren.",
      429,
      internal,
    );
  }
  // 2010 = kein routbarer Punkt in der Nähe, 2009 = Route nicht berechenbar.
  if (orsCode === 2010 || /point .*not .*found|could not find/i.test(orsMessage)) {
    return new OrsError(
      "Am gewählten Startpunkt liegt keine befahrbare Straße. Setz den Start näher an eine Straße.",
      422,
      internal,
    );
  }
  if (status === 404 || orsCode === 2009) {
    return new OrsError(
      "Von hier aus lässt sich keine Runde berechnen. Anderer Startpunkt oder kürzere Distanz.",
      422,
      internal,
    );
  }
  if (status >= 500) {
    return new OrsError(
      "Der Routing-Dienst antwortet gerade nicht. In ein paar Minuten nochmal versuchen.",
      502,
      internal,
    );
  }
  return new OrsError(
    "Der Routing-Dienst hat die Anfrage abgelehnt. Parameter etwas konservativer wählen.",
    502,
    internal,
  );
}

async function orsFetch(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${ORS_BASE}${path}`, {
      ...init,
      headers: { Authorization: apiKey(), ...init.headers },
      // Wir cachen selbst und wollen keine stille Next-Datencache-Schicht dazwischen.
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    if (cause instanceof OrsError) throw cause;
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new OrsError(
      timedOut
        ? "Der Routing-Dienst hat zu lange gebraucht. Nochmal versuchen."
        : "Der Routing-Dienst ist nicht erreichbar.",
      504,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  if (!response.ok) throw translate(response.status, await response.text());
  return response.json();
}

export type OrsRouteResult = {
  coordinates: Position3[];
  distance: number;
  ascent: number;
  descent: number;
};

/**
 * Reines Prosa-Routing über die übergebenen Wegpunkte.
 *
 * `round_trip` ist hier bewusst raus: die Rundtour-Wegpunkte erzeugt jetzt
 * lib/routing/loop.ts, damit beide Engines dieselbe Schleifenform bekommen und
 * vergleichbar bleiben.
 */
export async function fetchRoute(args: {
  waypoints: ReadonlyArray<readonly [number, number]>;
  profile: Profile;
}): Promise<OrsRouteResult> {
  const raw = await orsFetch(`/v2/directions/${ORS_PROFILE[args.profile]}/geojson`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/geo+json" },
    body: JSON.stringify({
      coordinates: args.waypoints.map(([lon, lat]) => [lon, lat]),
      elevation: true,
      instructions: false,
    }),
  });

  const parsed = orsDirectionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrsError(
      "Die Antwort des Routing-Dienstes war unbrauchbar.",
      502,
      `schema mismatch: ${parsed.error.message.slice(0, 300)}`,
    );
  }

  const feature = parsed.data.features[0];
  const coordinates: Position3[] = feature.geometry.coordinates.map((c) => [
    c[0],
    c[1],
    c[2] ?? 0,
  ]);
  const distance = feature.properties.summary.distance;
  if (typeof distance !== "number" || distance <= 0) {
    throw new OrsError(
      "Der Routing-Dienst hat eine Runde ohne Länge geliefert.",
      502,
      "summary.distance missing",
    );
  }

  return {
    coordinates,
    distance,
    ascent: feature.properties.ascent ?? 0,
    descent: feature.properties.descent ?? 0,
  };
}

export async function geocodeSearch(text: string, focus?: LatLon): Promise<GeocodeHit[]> {
  if (geocodeBudget.available() <= 0) {
    throw new OrsError(
      "Zu viele Suchanfragen kurz hintereinander. Einen Moment warten.",
      429,
      "geocode minute budget exhausted",
    );
  }
  geocodeBudget.consume(1);

  const params = new URLSearchParams({ text, size: "6" });
  if (focus) {
    params.set("focus.point.lat", String(focus.lat));
    params.set("focus.point.lon", String(focus.lon));
  }

  const raw = await orsFetch(`/geocode/search?${params.toString()}`, { method: "GET" });
  const parsed = orsGeocodeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrsError("Die Ortssuche hat unbrauchbare Daten geliefert.", 502, parsed.error.message);
  }

  return parsed.data.features.map((f) => ({
    label: f.properties.label,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}

