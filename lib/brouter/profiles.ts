import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { RoutingError, type NetworkPreference } from "@/lib/routing/adapter";
import type { Profile } from "@/lib/routing/constants";
import { BROUTER_BASE, BROUTER_USER_AGENT } from "./constants";

/**
 * Profilbeschaffung für BRouter.
 *
 * Der Netz-Regler braucht Einfluss auf zwei Variablen im Profil. Der
 * dokumentierte Weg über Query-Parameter (`profile:xxx`, ServerHandler.java)
 * antwortet auf brouter.de durchgängig mit HTTP 500 — nicht nutzbar. Bleibt
 * der Upload-Endpoint, der eine ID wie `custom_1787675915615` zurückgibt.
 *
 * Es gibt keine Abkürzung über Standardprofile mehr: unsere Vorlagen weichen
 * auch abseits des Reglers vom Original ab (keine Fähren, Umweg-Korrektur),
 * also wird jede Kombination hochgeladen. Macht sechs Profile, die nach dem
 * ersten Gebrauch im Speicher liegen.
 *
 * Die IDs liegen bewusst nicht in der Env: sie sehen nach Zeitstempeln aus und
 * es gibt keine Zusage, dass brouter.de sie dauerhaft behält. Stattdessen laden
 * wir bei Bedarf hoch und laden bei Fehlschlag neu.
 */

const TEMPLATE_FILE: Record<Profile, string> = {
  road: "fastbike-base.brf",
  tour: "trekking-base.brf",
};

/** Belegung der beiden Profilvariablen je Stufe. */
const VARIANTS: Record<NetworkPreference, { ignore: boolean; stick: boolean }> = {
  ignore: { ignore: true, stick: false },
  prefer: { ignore: false, stick: false },
  only: { ignore: false, stick: true },
};

type CacheEntry = { id: string; uploadedAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();
const templates = new Map<Profile, string>();

async function loadTemplate(profile: Profile): Promise<string> {
  const cached = templates.get(profile);
  if (cached) return cached;

  const file = path.join(process.cwd(), "profiles", TEMPLATE_FILE[profile]);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    throw new RoutingError("Die Routing-Profile fehlen auf dem Server.", 500, {
      internal: `cannot read ${file}: ${cause instanceof Error ? cause.message : cause}`,
    });
  }
  templates.set(profile, text);
  return text;
}

function render(base: string, vars: { ignore: boolean; stick: boolean }): string {
  const out = base
    .replaceAll("%%IGNORE_CYCLEROUTES%%", String(vars.ignore))
    .replaceAll("%%STICK_TO_CYCLEROUTES%%", String(vars.stick));
  if (out.includes("%%")) {
    throw new RoutingError("Das Routing-Profil ist unvollständig.", 500, {
      internal: "unreplaced placeholder in profile template",
    });
  }
  return out;
}

async function upload(body: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${BROUTER_BASE}/brouter/profile`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "User-Agent": BROUTER_USER_AGENT },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    throw new RoutingError("Der Routing-Dienst ist nicht erreichbar.", 504, {
      internal: `profile upload failed: ${cause instanceof Error ? cause.message : cause}`,
    });
  }

  if (!response.ok) {
    throw new RoutingError("Der Routing-Dienst hat das Profil abgelehnt.", 502, {
      internal: `profile upload ${response.status}: ${(await response.text()).slice(0, 200)}`,
    });
  }

  const raw: unknown = await response.json();
  const id =
    typeof raw === "object" && raw !== null && "profileid" in raw && typeof raw.profileid === "string"
      ? raw.profileid
      : null;
  const error =
    typeof raw === "object" && raw !== null && "error" in raw && typeof raw.error === "string"
      ? raw.error
      : null;

  // BRouter antwortet auch bei fehlerhaften Profilen mit 200 und vergibt eine ID.
  if (error) {
    throw new RoutingError("Der Routing-Dienst hat das Profil abgelehnt.", 502, {
      internal: `profile upload rejected: ${error}`,
    });
  }
  if (!id) {
    throw new RoutingError("Der Routing-Dienst hat keine Profil-ID geliefert.", 502, {
      internal: `profile upload without id: ${JSON.stringify(raw).slice(0, 200)}`,
    });
  }
  return id;
}

const keyOf = (profile: Profile, preference: NetworkPreference) => `${profile}:${preference}`;

export async function resolveProfile(
  profile: Profile,
  preference: NetworkPreference,
): Promise<string> {
  const key = keyOf(profile, preference);
  const hit = cache.get(key);
  if (hit) return hit.id;

  // Parallele Anfragen sollen nicht dasselbe Profil mehrfach hochladen.
  const running = inflight.get(key);
  if (running) return running;

  const task = (async () => {
    const body = render(await loadTemplate(profile), VARIANTS[preference]);
    const id = await upload(body);
    cache.set(key, { id, uploadedAt: Date.now() });
    return id;
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

/**
 * Eine gecachte ID verwerfen, damit der nächste Aufruf neu hochlädt.
 * Wird aufgerufen, wenn der Server ein Profil nicht mehr kennt.
 */
export function invalidateProfile(profile: Profile, preference: NetworkPreference): void {
  cache.delete(keyOf(profile, preference));
}

/** Nur für Diagnose/Tests. */
export function profileCacheState(): Array<{ key: string; id: string; ageMs: number }> {
  const now = Date.now();
  return [...cache.entries()].map(([key, v]) => ({ key, id: v.id, ageMs: now - v.uploadedAt }));
}
