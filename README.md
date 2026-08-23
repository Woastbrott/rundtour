# Rundtour

Generiert aus **Startpunkt + Zieldauer (oder Zieldistanz) + gewünschter Höhenstufe** mehrere
zufällige Rundtouren, zeigt sie auf der Karte und exportiert sie als GPX.
Zwei Profile: **Rennrad** (`cycling-road`) und **Radtour gemütlich** (`cycling-regular`).

Kein Login, keine Datenbank, keine Persistenz. Reload = leerer Zustand.

## Setup

```bash
npm install
```

`.env.local` anlegen (Vorlage: `.env.example`):

```
ORS_API_KEY=dein-key-von-account.heigit.org
```

Der Key ist **server-only**. Er wird nie ins Client-Bundle gereicht — alle ORS-Calls laufen über
die Route Handler unter `app/api/`.

```bash
npm run dev     # http://localhost:3000
npm run build
npx tsc --noEmit
npx eslint .
```

Für Vercel: `ORS_API_KEY` als Environment Variable setzen, sonst nichts.

## Aufbau

```
app/
  page.tsx                      Server Component, rendert die Client-Insel
  api/routes/generate/route.ts  Proxy: Kandidaten + Scoring
  api/geocode/route.ts          Proxy: Ortssuche
lib/
  ors/client.ts                 Fetch-Wrapper, server-only, Fehlerübersetzung
  ors/schema.ts                 Zod-Schemas + API-Vertrag
  ors/budget.ts                 Minutenbudget-Drossel
  routing/candidates.ts         Seeds, Scoring, Filter, Korrekturlauf
  routing/constants.ts          Alle Stellschrauben
  routing/estimate.ts           Dauer-/Distanz-Modell
  routing/geo.ts                Haversine, Bounds, Kompaktheit
  cache.ts                      TTL-Cache gegen Doppelanfragen
  spring.ts                     Feder-Physik fürs Bottom-Sheet
  gpx.ts                        GPX 1.1 von Hand
components/
  TourGenerator.tsx             Zustand + Layout-Weiche
  RouteMap.tsx                  MapLibre
  ControlPanel.tsx  PlaceSearch.tsx  BottomSheet.tsx
  RouteStats.tsx    CandidateTabs.tsx  ElevationProfile.tsx
  ui/Segmented.tsx  ui/Slider.tsx
```

## Was beim Tuning wichtig ist

Alle Werte in [`lib/routing/constants.ts`](lib/routing/constants.ts).

**`ORS_LENGTH_COMPENSATION = 0.78`** ist der wichtigste. ORS liefert bei `round_trip`
verlässlich **mehr** als die angeforderte `length` — gemessen über Radolfzell (cycling-road,
15 Seeds, 3 Zieldistanzen) lag Ist/Soll zwischen 1.15 und 1.62, Median ~1.28. Ohne
Vorkompensation verwirft der ±25 %-Filter praktisch jeden Kandidaten. Wer die App in einer
anderen Region betreibt, sollte diesen Faktor nachmessen.

**`TARGET_HM_PER_KM`** sind Startwerte (3 / 8 / 15 / 25). Im Hegau liefert ORS selten unter
10 hm/km — „flach" ist dort schlicht nicht verfügbar. Das ist eine Eigenschaft der Gegend,
kein Fehler: die App zeigt die tatsächlichen Werte an und verspricht vorher nichts.

## Grenzen, die bekannt sind

- **`cycling-road` ist kein echtes Rennradprofil.** Wenn Routen über Feldwege führen, ist das
  eine Grenze der ORS-Profile, nicht des Codes.
- **`round_trip` liefert regelmäßig Nicht-Runden** — Achterschleifen oder Strecken, die auf
  derselben Straße zurückführen. Dagegen laufen zwei Filter: die ±25 %-Toleranz und ein
  Kompaktheitsmaß (`4πA/U²`), das eingeschlossene Fläche gegen Umfang stellt und bei einer
  Hin-und-zurück-Strecke gegen 0 geht.
- **Höhenmeter treffen nie exakt.** Deshalb vier Stufen statt einer Zahl.
- **Rate Limits.** Free Tier: 2000 Directions-Requests/Tag, ~40/Minute. Ein Klick auf
  „Generieren" kostet 8 Calls, mit Nachschlag 14. `lib/ors/budget.ts` zählt in einem
  gleitenden 60-s-Fenster mit und drosselt, bevor ORS mit einem headerlosen 429 abriegelt.
  Das Budget gilt pro Serverinstanz — bei mehreren Instanzen bräuchte es einen geteilten Zähler.

## Bewusste Abweichung vom ursprünglichen Konzept

Im **Dauer-Modus** wird gegen die *Dauer* gefiltert und gescort, nicht gegen die aus der Dauer
abgeleitete Ersatzdistanz. Die Umrechnung Dauer → Distanz ist nur eine Hilfsgröße für den
ORS-Call; über sie zu filtern warf genau die Kandidaten weg, die die Zeit am besten trafen
(beste Abweichung vorher 17 %, danach 1 %). Der Distanz-Modus bleibt unverändert.
Umschaltpunkt ist `primaryDeviation()` in [`lib/routing/candidates.ts`](lib/routing/candidates.ts).
