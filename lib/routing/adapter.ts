import type { LngLat } from "./loop";
import type { Profile } from "./constants";

/**
 * Wie stark sich die Route an das beschilderte Radverkehrsnetz halten soll.
 *
 * Achtung, das ist eine Gewichtung, keine Sperre: auch bei "only" nimmt die
 * Engine die Straße, wenn kein beschilderter Weg zum nächsten Wegpunkt führt.
 * Das UI-Label muss das hergeben.
 */
export const NETWORK_PREFERENCES = ["ignore", "prefer", "only"] as const;
export type NetworkPreference = (typeof NETWORK_PREFERENCES)[number];

export function isNetworkPreference(value: string): value is NetworkPreference {
  return (NETWORK_PREFERENCES as readonly string[]).includes(value);
}

export type RouteRequest = {
  /** Start am Anfang UND am Ende — das macht die Runde. */
  waypoints: LngLat[];
  profile: Profile;
  networkPreference: NetworkPreference;
};

export type RouteResult = {
  /** [lng, lat, ele] */
  geometry: Array<[number, number, number]>;
  distanceM: number;
  ascentM: number;
  descentM: number;
};

export interface RoutingAdapter {
  readonly name: string;
  route(req: RouteRequest): Promise<RouteResult>;
}

/**
 * Fehler einer Routing-Engine. `userMessage` darf an den Client,
 * alles Interne bleibt in `message` und damit serverseitig.
 *
 * `retryable` heißt: dieser eine Kandidat ist gescheitert, ein anderer Seed
 * kann trotzdem klappen — nicht den ganzen Durchlauf abbrechen.
 */
export class RoutingError extends Error {
  readonly status: number;
  readonly userMessage: string;
  readonly retryable: boolean;
  /**
   * Der Fehler sieht danach aus, als kenne der Server das hochgeladene Profil
   * nicht mehr. Nur dann lohnt ein Neu-Upload — bei einem Timeout wäre er
   * sinnlos und würde die Wartezeit verdoppeln.
   */
  readonly profileSuspect: boolean;

  constructor(
    userMessage: string,
    status: number,
    options: { internal?: string; retryable?: boolean; profileSuspect?: boolean } = {},
  ) {
    super(options.internal ?? userMessage);
    this.name = "RoutingError";
    this.status = status;
    this.userMessage = userMessage;
    this.retryable = options.retryable ?? false;
    this.profileSuspect = options.profileSuspect ?? false;
  }
}
