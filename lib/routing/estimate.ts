import { PACE_CLIMB_MH, PACE_SPEED_KMH, type Pace, type Profile } from "./constants";

/** Fahrprofil plus Tempo — beide zusammen bestimmen die Zeitschätzung. */
export type Rider = { profile: Profile; pace: Pace };

/**
 * Fahrzeit = Flachfahrzeit + Kletterzuschlag.
 * Bewusst simpel: die Unsicherheit steckt ohnehin im Fahrer, nicht im Modell.
 */
export function estimateDurationHours(distanceKm: number, ascentM: number, rider: Rider): number {
  return (
    distanceKm / PACE_SPEED_KMH[rider.profile][rider.pace] +
    ascentM / PACE_CLIMB_MH[rider.profile][rider.pace]
  );
}

/** Startschätzung für den Routing-Call, wenn der Nutzer eine Dauer vorgibt. */
export function distanceFromDurationKm(hours: number, rider: Rider): number {
  return hours * PACE_SPEED_KMH[rider.profile][rider.pace];
}

export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
