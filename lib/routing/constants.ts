/**
 * Alle nachjustierbaren Stellschrauben des Generators an einem Ort.
 * Die ORS-bezogenen Werte sind gemessen, nicht geraten — siehe ORS_LENGTH_COMPENSATION.
 */

export const PROFILES = ["road", "tour"] as const;
export type Profile = (typeof PROFILES)[number];

/** Interne Profil-ID -> ORS-Profil. */
export const ORS_PROFILE: Record<Profile, string> = {
  road: "cycling-road",
  tour: "cycling-regular",
};

export const PROFILE_LABEL: Record<Profile, string> = {
  road: "Rennrad",
  tour: "Radtour",
};

/** Durchschnittsgeschwindigkeit in der Ebene, km/h. */
export const BASE_SPEED_KMH: Record<Profile, number> = { road: 24, tour: 15 };

/** Kletterleistung, Höhenmeter pro Stunde — Aufschlag auf die Flachfahrzeit. */
export const CLIMB_RATE_MH: Record<Profile, number> = { road: 600, tour: 400 };

export const TERRAINS = ["flach", "wellig", "huegelig", "bergig"] as const;
export type Terrain = (typeof TERRAINS)[number];

export const TERRAIN_LABEL: Record<Terrain, string> = {
  flach: "flach",
  wellig: "wellig",
  huegelig: "hügelig",
  bergig: "bergig",
};

/** Ziel-Höhenmeter pro Kilometer je Stufe. Startwerte, bewusst grob. */
export const TARGET_HM_PER_KM: Record<Terrain, number> = {
  flach: 3,
  wellig: 8,
  huegelig: 15,
  bergig: 25,
};

/** Scoring-Gewichte: Distanzabweichung wiegt schwerer als Höhenabweichung. */
export const SCORE_WEIGHTS = { distance: 1.0, elevation: 0.8 } as const;

/** Kandidaten außerhalb dieser relativen Abweichung vom Ziel fliegen raus. */
export const DISTANCE_TOLERANCE = 0.25;

/**
 * Zweite, weichere Schwelle. Kommen mit DISTANCE_TOLERANCE weniger als drei
 * Vorschläge zusammen, wird einmal hierauf gelockert — ohne zusätzliche ORS-Calls
 * und ohne die Reihenfolge zu ändern. Der beste Treffer bleibt der beste Treffer.
 */
export const RELAXED_TOLERANCE = 0.45;

/** Nenner-Untergrenze beim Höhen-Score, damit "flach" nicht durch 3 dividiert explodiert. */
export const HM_SCORE_FLOOR = 5;

export const CANDIDATE_COUNT = 8;
/** Zweiter Anlauf ist kleiner — er kostet Kontingent und ist die Ausnahme. */
export const RETRY_CANDIDATE_COUNT = 6;
export const RESULT_COUNT = 3;

/**
 * ORS liefert bei round_trip verlässlich MEHR als die angeforderte `length`.
 * Gemessen am 23.08.2026 über Radolfzell, cycling-road, 15 Seeds, 3 Zieldistanzen:
 * Ist/Soll lag zwischen 1.15 und 1.62, Median ~1.28. Ohne Vorkompensation würde
 * der ±25%-Filter praktisch jeden Kandidaten verwerfen.
 * -> Wir fragen 1/1.28 ≈ 0.78 der Zieldistanz an.
 */
export const ORS_LENGTH_COMPENSATION = 0.78;

/** round_trip.points je Kandidat, zyklisch — mehr Formvielfalt bei ähnlicher Längen-Charakteristik. */
export const ROUND_TRIP_POINTS = [4, 5, 6] as const;

/** Parallele ORS-Requests. Free Tier verträgt mehr, aber es gibt keinen Grund zu drängeln. */
export const ORS_CONCURRENCY = 4;

/** Abweichung der geschätzten Dauer vom Ziel, ab der einmal nachkorrigiert wird. */
export const DURATION_CORRECTION_THRESHOLD = 0.15;

export const DISTANCE_RANGE_KM = { min: 10, max: 200 } as const;
export const DURATION_RANGE_MIN = { min: 30, max: 480 } as const;

export function isProfile(value: string): value is Profile {
  return (PROFILES as readonly string[]).includes(value);
}

export function isTerrain(value: string): value is Terrain {
  return (TERRAINS as readonly string[]).includes(value);
}
