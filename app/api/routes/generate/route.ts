import { createTtlCache } from "@/lib/cache";
import { generateRequestSchema } from "@/lib/ors/schema";
import { generateRoutes, type GenerateEvent } from "@/lib/routing/candidates";

export const dynamic = "force-dynamic";

/**
 * Antwort ist NDJSON: eine JSON-Zeile pro Ereignis.
 *
 * Grund: die Kandidaten laufen sequenziell mit Pause gegen einen Community-Server,
 * das dauert je nach Gegend 10 bis 25 Sekunden. Eine einzelne Antwort am Ende
 * hieße Spinner ohne Rückmeldung; so ist die erste Route auf der Karte, während
 * die restlichen noch berechnet werden.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = createTtlCache<string>(CACHE_TTL_MS);

function cacheKey(input: unknown): string {
  const i = input as ReturnType<typeof generateRequestSchema.parse>;
  return JSON.stringify({
    // Auf ~50 m runden: minimale Kartenklicks sollen den Cache nicht sprengen.
    lat: i.start.lat.toFixed(4),
    lon: i.start.lon.toFixed(4),
    profile: i.profile,
    terrain: i.terrain,
    network: i.networkPreference,
    pace: i.pace,
    target: i.target,
    nonce: i.nonce,
  });
}

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  // Verhindert, dass ein Proxy die Antwort puffert und den Fortschritt einebnet.
  "X-Accel-Buffering": "no",
} as const;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ungültiger Request-Body." }, { status: 400 });
  }

  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Die Parameter sind außerhalb des gültigen Bereichs." },
      { status: 400 },
    );
  }

  const key = cacheKey(parsed.data);
  const cached = cache.get(key);
  if (cached) {
    return new Response(cached, { headers: NDJSON_HEADERS });
  }

  const encoder = new TextEncoder();
  const recorded: string[] = [];
  let complete = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: GenerateEvent) => {
        const line = `${JSON.stringify(event)}\n`;
        recorded.push(line);
        controller.enqueue(encoder.encode(line));
      };

      try {
        for await (const event of generateRoutes(parsed.data, request.signal)) {
          write(event);
          if (event.type === "result") complete = true;
        }
      } catch (error) {
        console.error("[generate] unerwarteter Fehler", error);
        // Der Header ist längst raus — der Fehler muss als Ereignis in den Stream.
        write({
          type: "error",
          status: 500,
          message: "Beim Generieren ist etwas schiefgegangen. Nochmal versuchen.",
        });
      } finally {
        // Nur vollständige Durchläufe cachen. Ein abgebrochener wäre Müll im Cache.
        if (complete && !request.signal.aborted) cache.set(key, recorded.join(""));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
