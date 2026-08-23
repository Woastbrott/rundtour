import "server-only";

/**
 * Minutenbudget für ORS.
 *
 * Der Free Tier deckelt bei rund 40 Requests pro Minute. Ein 429 kommt ohne
 * `Retry-After` und ohne Ratelimit-Header zurück — es gibt also nichts, woran
 * man sich orientieren könnte. Deshalb zählen wir selbst mit und drosseln,
 * bevor ORS abriegelt.
 *
 * Gleitendes Fenster im Modul-Scope: gilt pro Serverinstanz. Für eine App ohne
 * Login und ohne nennenswerte Parallelnutzung ist das die passende Genauigkeit;
 * bei mehreren Instanzen müsste das Budget in einen geteilten Speicher.
 */

const WINDOW_MS = 60_000;

export type Budget = {
  /** Wie viele Requests jetzt sofort rausdürfen. */
  available: () => number;
  /** Slots belegen, bevor die Requests losgehen. */
  consume: (count: number) => void;
  /** Millisekunden, bis wieder mindestens ein Slot frei wird. */
  msUntilFree: () => number;
};

function createBudget(perMinute: number): Budget {
  const stamps: number[] = [];

  const prune = (now: number) => {
    while (stamps.length > 0 && now - stamps[0] >= WINDOW_MS) stamps.shift();
  };

  return {
    available() {
      prune(Date.now());
      return Math.max(perMinute - stamps.length, 0);
    },
    consume(count) {
      const now = Date.now();
      prune(now);
      for (let i = 0; i < count; i++) stamps.push(now);
    },
    msUntilFree() {
      const now = Date.now();
      prune(now);
      if (stamps.length < perMinute) return 0;
      return Math.max(WINDOW_MS - (now - stamps[0]), 0);
    },
  };
}

/** 34 statt 40: Puffer für parallele Tabs und für Ungenauigkeit im Fenster. */
export const directionsBudget = createBudget(34);

/** Geocoding hat ein eigenes, großzügigeres Kontingent. */
export const geocodeBudget = createBudget(80);
