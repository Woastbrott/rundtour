import { createTtlCache } from "@/lib/cache";
import { geocodeSearch, OrsError } from "@/lib/ors/client";
import { geocodeRequestSchema, type GeocodeHit } from "@/lib/ors/schema";

export const dynamic = "force-dynamic";

/** Tippen erzeugt viele Anfragen — 5 Minuten Cache halten das Geocoding-Kontingent flach. */
const cache = createTtlCache<GeocodeHit[]>(5 * 60 * 1000);

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");

  const parsed = geocodeRequestSchema.safeParse({
    text: url.searchParams.get("text") ?? "",
    focus: lat && lon ? { lat: Number(lat), lon: Number(lon) } : undefined,
  });
  if (!parsed.success) return Response.json({ hits: [] });

  const key = `${parsed.data.text.toLowerCase()}|${parsed.data.focus?.lat.toFixed(2) ?? ""},${parsed.data.focus?.lon.toFixed(2) ?? ""}`;
  const cached = cache.get(key);
  if (cached) return Response.json({ hits: cached });

  try {
    const hits = await geocodeSearch(parsed.data.text, parsed.data.focus);
    cache.set(key, hits);
    return Response.json({ hits });
  } catch (error) {
    if (error instanceof OrsError) {
      console.error("[geocode]", error.message);
      return Response.json({ error: error.userMessage }, { status: error.status });
    }
    console.error("[geocode] unerwarteter Fehler", error);
    return Response.json({ error: "Die Ortssuche ist gerade nicht erreichbar." }, { status: 500 });
  }
}
