import { z } from "zod";
import { NETWORK_PREFERENCES } from "@/lib/routing/adapter";
import {
  DEFAULT_PACE,
  DISTANCE_RANGE_KM,
  DURATION_RANGE_MIN,
  PACES,
  PROFILES,
  TERRAINS,
} from "@/lib/routing/constants";

/* ------------------------------------------------------------------ *
 * Eingehende Requests an unsere eigenen Route Handler
 * ------------------------------------------------------------------ */

export const latLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type LatLon = z.infer<typeof latLonSchema>;

export const generateRequestSchema = z.object({
  start: latLonSchema,
  profile: z.enum(PROFILES),
  terrain: z.enum(TERRAINS),
  target: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("duration"),
      minutes: z.number().int().min(DURATION_RANGE_MIN.min).max(DURATION_RANGE_MIN.max),
    }),
    z.object({
      mode: z.literal("distance"),
      km: z.number().min(DISTANCE_RANGE_KM.min).max(DISTANCE_RANGE_KM.max),
    }),
  ]),
  /**
   * Wie stark sich die Route ans beschilderte Radverkehrsnetz halten soll.
   * Beim Rennrad-Profil serverseitig auf "ignore" gezwungen.
   */
  networkPreference: z.enum(NETWORK_PREFERENCES).default("prefer"),
  /**
   * Tempo-Stufe. Ändert nur die Zeitschätzung, nicht die Streckenwahl — im
   * Dauer-Modus wirkt sie dennoch aufs Ergebnis, weil aus der Zielzeit die
   * Zieldistanz abgeleitet wird.
   */
  pace: z.enum(PACES).default(DEFAULT_PACE),
  /** Wird bei jedem "Neu würfeln" hochgezählt und geht in Seeds + Cache-Key ein. */
  nonce: z.number().int().min(0).max(1_000_000).default(0),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const geocodeRequestSchema = z.object({
  text: z.string().trim().min(2).max(140),
  focus: latLonSchema.optional(),
});

/* ------------------------------------------------------------------ *
 * ORS-Antworten — unbekannte Form, deshalb geparst statt geglaubt
 * ------------------------------------------------------------------ */

/** [lon, lat, ele] wenn elevation:true, sonst [lon, lat]. */
const positionSchema = z.array(z.number()).min(2);

export const orsDirectionsSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(positionSchema).min(2),
        }),
        properties: z.object({
          ascent: z.number().optional(),
          descent: z.number().optional(),
          summary: z
            .object({
              distance: z.number().optional(),
              duration: z.number().optional(),
            })
            .default({}),
        }),
      }),
    )
    .min(1),
});

export const orsGeocodeSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.array(z.number()).min(2),
      }),
      properties: z.object({
        label: z.string(),
        name: z.string().optional(),
        layer: z.string().optional(),
      }),
    }),
  ),
});

/** ORS meldet Fehler mal als String, mal als Objekt. */
export const orsErrorSchema = z.object({
  error: z.union([
    z.string(),
    z.object({ code: z.number().optional(), message: z.string().optional() }),
  ]),
});

/* ------------------------------------------------------------------ *
 * Was unsere API zurückgibt (Vertrag Server -> Client)
 * ------------------------------------------------------------------ */

/** [lon, lat, ele] — Reihenfolge wie GeoJSON, nicht wie Leaflet. */
export type Position3 = [number, number, number];

export type RouteCandidate = {
  id: string;
  /** Meter. */
  distance: number;
  ascent: number;
  descent: number;
  /** Unsere Schätzung in Stunden, nicht die ORS-Fahrzeit. */
  durationH: number;
  hmPerKm: number;
  score: number;
  coordinates: Position3[];
  bbox: [number, number, number, number];
};

export type GenerateResponse = {
  candidates: RouteCandidate[];
  /** Zieldistanz in km, nach eventueller Dauer-Korrektur. */
  targetKm: number;
  targetHmPerKm: number;
  /** Wie viele ORS-Calls das gekostet hat — im UI nicht sichtbar, aber nützlich beim Debuggen. */
  requests: number;
  /** Gesetzt, wenn weniger als RESULT_COUNT brauchbare Runden entstanden sind. */
  notice?: string;
};

export type GeocodeHit = {
  label: string;
  lat: number;
  lon: number;
};
