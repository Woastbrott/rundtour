import "server-only";

import {
  RoutingError,
  type RouteRequest,
  type RouteResult,
  type RoutingAdapter,
} from "@/lib/routing/adapter";
import { directionsBudget } from "./budget";
import { fetchRoute, OrsError } from "./client";

/**
 * ORS als Fallback-Engine hinter demselben Interface.
 *
 * Der Netz-Regler ist hier nicht umsetzbar: ORS kann nicht nach Zugehörigkeit
 * zum Radverkehrsnetz filtern — genau deshalb der Wechsel zu BRouter. Statt das
 * still zu schlucken und eine Route zu liefern, die den Regler ignoriert,
 * scheitert "only" hier laut und sichtbar.
 */
export class OrsAdapter implements RoutingAdapter {
  readonly name = "ors";

  async route(req: RouteRequest): Promise<RouteResult> {
    if (req.networkPreference === "only") {
      throw new RoutingError(
        "„Möglichst nur beschilderte“ geht mit der ORS-Engine nicht — ORS kann das Radnetz nicht auswerten. Stell ROUTING_ENGINE auf brouter oder wähl eine andere Stufe.",
        400,
        { internal: 'OrsAdapter does not support networkPreference "only"' },
      );
    }

    if (directionsBudget.available() <= 0) {
      const seconds = Math.ceil(directionsBudget.msUntilFree() / 1000);
      throw new RoutingError(
        `Zu viele Anfragen in kurzer Zeit. Noch etwa ${seconds} Sekunden warten.`,
        429,
        { internal: "ors minute budget exhausted" },
      );
    }
    directionsBudget.consume(1);

    try {
      const result = await fetchRoute({ waypoints: req.waypoints, profile: req.profile });
      return {
        geometry: result.coordinates,
        distanceM: result.distance,
        ascentM: result.ascent,
        descentM: result.descent,
      };
    } catch (error) {
      if (error instanceof OrsError) {
        // 422 heißt meist: dieser eine Wegpunkt liegt ungünstig — anderer Seed kann klappen.
        throw new RoutingError(error.userMessage, error.status, {
          internal: error.message,
          retryable: error.status === 422 || error.status === 504,
        });
      }
      throw error;
    }
  }
}
