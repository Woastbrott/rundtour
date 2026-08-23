import "server-only";

/**
 * Winziger TTL-Cache im Modul-Scope. Zweck ist nicht Performance, sondern
 * Kontingentschutz: Doppelklicks, React-StrictMode-Doppelrenders und
 * identische Wiederholungen sollen keine acht ORS-Calls auslösen.
 * Auf Vercel lebt er pro warmer Lambda-Instanz — mehr braucht es hier nicht.
 */
type Entry<T> = { value: T; expires: number };

const MAX_ENTRIES = 40;

export function createTtlCache<T>(ttlMs: number) {
  const store = new Map<string, Entry<T>>();

  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires < Date.now()) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T): void {
      if (store.size >= MAX_ENTRIES) {
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
  };
}
