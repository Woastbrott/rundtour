import { BASE_SPEED_KMH, CLIMB_RATE_MH, type Profile } from "./constants";

/**
 * Fahrzeit = Flachfahrzeit + Kletterzuschlag.
 * Bewusst simpel: die Unsicherheit steckt ohnehin im Fahrer, nicht im Modell.
 */
export function estimateDurationHours(
  distanceKm: number,
  ascentM: number,
  profile: Profile,
): number {
  return distanceKm / BASE_SPEED_KMH[profile] + ascentM / CLIMB_RATE_MH[profile];
}

/** Startschätzung für den Routing-Call, wenn der Nutzer eine Dauer vorgibt. */
export function distanceFromDurationKm(hours: number, profile: Profile): number {
  return hours * BASE_SPEED_KMH[profile];
}

export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
