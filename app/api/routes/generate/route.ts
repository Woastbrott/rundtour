import { createTtlCache } from "@/lib/cache";
import { OrsError } from "@/lib/ors/client";
import { generateRequestSchema, type GenerateResponse } from "@/lib/ors/schema";
import { generateRoutes } from "@/lib/routing/candidates";

/** Route Handler: immer frisch rechnen, Caching machen wir bewusst selbst. */
export const dynamic = "force-dynamic";

const cache = createTtlCache<GenerateResponse>(10 * 60 * 1000);

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

  // Startpunkt auf ~10 m runden: minimale Mausbewegungen sollen den Cache nicht sprengen.
  const input = parsed.data;
  const key = JSON.stringify({
    lat: input.start.lat.toFixed(4),
    lon: input.start.lon.toFixed(4),
    profile: input.profile,
    terrain: input.terrain,
    target: input.target,
    nonce: input.nonce,
  });

  const cached = cache.get(key);
  if (cached) return Response.json(cached);

  try {
    const result = await generateRoutes(input);
    cache.set(key, result);
    return Response.json(result);
  } catch (error) {
    if (error instanceof OrsError) {
      console.error("[generate]", error.message);
      return Response.json({ error: error.userMessage }, { status: error.status });
    }
    console.error("[generate] unerwarteter Fehler", error);
    return Response.json(
      { error: "Beim Generieren ist etwas schiefgegangen. Nochmal versuchen." },
      { status: 500 },
    );
  }
}
