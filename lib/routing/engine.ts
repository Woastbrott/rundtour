import "server-only";

import { BRouterAdapter } from "@/lib/brouter/client";
import { OrsAdapter } from "@/lib/ors/adapter";
import type { RoutingAdapter } from "./adapter";

/**
 * Welche Engine läuft, entscheidet ROUTING_ENGINE. Default ist brouter —
 * nur die kann den Netz-Regler, und sie braucht keinen API-Key.
 * ORS bleibt als Fallback erreichbar (ROUTING_ENGINE=ors), braucht dann aber
 * weiterhin ORS_API_KEY.
 */
const ADAPTERS = { brouter: BRouterAdapter, ors: OrsAdapter } as const;
export type EngineName = keyof typeof ADAPTERS;

let cached: RoutingAdapter | null = null;

export function routingEngine(): RoutingAdapter {
  if (cached) return cached;

  const configured = process.env.ROUTING_ENGINE?.trim().toLowerCase();
  const name: EngineName = configured === "ors" ? "ors" : "brouter";
  if (configured && configured !== "ors" && configured !== "brouter") {
    console.warn(`[routing] Unbekannte ROUTING_ENGINE "${configured}", nutze brouter.`);
  }

  cached = new ADAPTERS[name]();
  return cached;
}
