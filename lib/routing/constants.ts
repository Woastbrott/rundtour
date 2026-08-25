/**
 * Alle nachjustierbaren Stellschrauben des Generators an einem Ort.
 * Die Zahlen hier sind gemessen, nicht geraten — die Herkunft steht jeweils dabei.
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

/**
 * Ziel-Höhenmeter pro Kilometer je Stufe.
 *
 * ACHTUNG, diese Werte gehören zu BRouters `filtered ascend` und sind rund ein
 * Drittel der alten ORS-Werte (3/8/15/25). Das ist kein Tippfehler: BRouter
 * filtert Höhenrauschen weg, ORS nicht. Gemessen liegt roh/gefiltert bei ~1.74,
 * ORS lag nochmal etwa 1.5–2x über BRouters Rohwert.
 *
 * Neu ausgemessen am 24.08.2026 über Radolfzell: 16 Runden zwischen 25 und
 * 100 km ergaben 1.6 bis 9.7 hm/km, Median ~4.9. Die vier Stufen spannen diesen
 * Bereich auf, mit Luft nach oben für bergigere Gegenden.
 *
 * Wichtig fürs Verständnis der Ergebnisse: hm/km steigt hier mit der Distanz.
 * Kurze Runden bleiben im flachen Seebecken, lange greifen in den Hegau aus —
 * eine 25-km-Runde wird um Radolfzell nie "bergig", egal was der Regler sagt.
 */
export const TARGET_HM_PER_KM: Record<Terrain, number> = {
  flach: 1.5,
  wellig: 3,
  huegelig: 5,
  bergig: 8,
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

/**
 * Nenner-Untergrenze beim Höhen-Score, damit "flach" nicht durch einen winzigen
 * Zielwert dividiert explodiert. Musste mit der Tabelle mitwandern (vorher 5):
 * bei Zielwerten von 1.5 bis 8 hätte eine Untergrenze von 5 den Höhenterm für
 * die unteren drei Stufen praktisch eingeebnet und den Regler entwertet.
 */
export const HM_SCORE_FLOOR = 2;

export const CANDIDATE_COUNT = 5;
/** Zweiter Anlauf ist kleiner — er kostet Kontingent und ist die Ausnahme. */
export const RETRY_CANDIDATE_COUNT = 3;
export const RESULT_COUNT = 3;

/* ------------------------------------------------------------------ *
 * Rundtour-Wegpunkte (BRouter hat kein round_trip, wir bauen den Ring selbst)
 * ------------------------------------------------------------------ */

/** Zwischenziele auf dem Ring. */
export const LOOP_POINTS = 5;

/**
 * Radius des Wegpunkt-Rings, als Faktor auf Zieldistanz/(2π).
 *
 * Der naive Wert wäre 1.0 (Kreisumfang), plus Zuschlag für Straßenumwege. Das
 * ist falsch, weil der Start im *Zentrum* des Rings liegt: der Weg ist einmal
 * Radius raus, vier Sehnen zwischen den Ringpunkten, einmal Radius zurück —
 * geometrisch rund 6.7·r statt 2π·r. Zusammen mit realen Straßenumwegen kam
 * mit dem Startwert 1.15 die 2.2-fache Zieldistanz heraus.
 *
 * Gemessen am 24.08.2026 über Radolfzell: Faktor 0.42 -> Ist/Soll 0.73,
 * 0.52 -> 0.90, 0.62 -> 1.02…1.09. Daraus 0.58 als Mitte.
 * In einer anderen Gegend nachmessen — Seen und Berge verschieben das.
 */
export const LOOP_RADIUS_FACTOR = 0.58;

/** Radius-Jitter je Punkt: Faktor zwischen MIN und MIN+SPAN. Ohne das wird es ein Kreis. */
export const LOOP_JITTER_MIN = 0.85;
export const LOOP_JITTER_SPAN = 0.3;


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
