# Rundtour

Generiert aus **Startpunkt + Zieldauer (oder Zieldistanz) + Höhenstufe + Tempo** mehrere
zufällige Rundtouren, zeigt sie auf der Karte und exportiert sie als GPX.
Zwei Profile — **Rennrad** und **Radtour gemütlich** — beide mit einem Regler, wie stark die
Route den beschilderten Radwegweisern folgen soll, und vier Tempo-Stufen von „gemütlich"
bis „Pogačar".

Kein Login, keine Datenbank, keine Persistenz. Reload = leerer Zustand.

## Setup

```bash
npm install
npm run dev
```

Läuft ohne Konfiguration: Routing geht über **BRouter**, das keinen API-Key braucht.

Für die **Ortssuche** (und nur dafür) wird ein ORS-Key gebraucht. `.env.local` anlegen,
Vorlage ist `.env.example`:

```
ORS_API_KEY=dein-key-von-account.heigit.org
```

Ohne Key funktionieren Karte, Startpunkt per Klick, „Mein Standort" und das gesamte Routing —
nur die Textsuche nicht.

Der Key ist **server-only** und wird nie ins Client-Bundle gereicht; alle Aufrufe laufen über
die Route Handler unter `app/api/`.

```bash
npm run build
npx tsc --noEmit
npx eslint .
```

## Aufbau

```
app/
  page.tsx                      Server Component, rendert die Client-Insel
  api/routes/generate/route.ts  Proxy, antwortet als NDJSON-Stream
  api/geocode/route.ts          Proxy: Ortssuche (ORS)
lib/
  routing/adapter.ts            Interface beider Engines + RoutingError
  routing/engine.ts             Auswahl per ROUTING_ENGINE
  routing/candidates.ts         Seeds, Scoring, Filter, Korrekturlauf (Generator)
  routing/loop.ts               Rundtour-Wegpunkte, seed-basiert
  routing/constants.ts          Alle Stellschrauben
  routing/estimate.ts           Dauer-/Distanz-Modell
  routing/geo.ts                Haversine, Zielpunkt, Bounds, Kompaktheit
  brouter/client.ts             BRouterAdapter
  brouter/profiles.ts           Profil-Upload und -Cache
  ors/client.ts                 ORS-Fetch, Fehlerübersetzung, Geocoding
  ors/adapter.ts                OrsAdapter (Fallback)
  ors/budget.ts                 Minutenbudget-Drossel für ORS
  cache.ts                      TTL-Cache
  spring.ts                     Feder-Physik fürs Bottom-Sheet
  gpx.ts                        GPX 1.1 von Hand
profiles/trekking-base.brf      Vorlage Radtour (BRouter-Profil)
profiles/fastbike-base.brf      Vorlage Rennrad (BRouter-Profil)
components/
  TourGenerator.tsx             Zustand, Stream-Verarbeitung, Layout-Weiche
  RouteMap.tsx                  MapLibre
  ControlPanel.tsx  PlaceSearch.tsx  BottomSheet.tsx
  RouteStats.tsx    CandidateTabs.tsx  ElevationProfile.tsx
  ui/Segmented.tsx  ui/Slider.tsx
```

**Routing-Details stehen in [ROUTING.md](ROUTING.md)** — warum BRouter, wie der Netz-Regler
umgesetzt ist, wie die Konstanten ausgemessen wurden und was `only` nicht garantiert.

## Was beim Tuning wichtig ist

Alle Werte in [`lib/routing/constants.ts`](lib/routing/constants.ts).

**`LOOP_RADIUS_FACTOR = 0.72`** ist der wichtigste. Er bestimmt, wie groß der Wegpunkt-Ring
um den Start wird, und damit die Distanz. Ausgemessen über Radolfzell — in einer anderen
Gegend nachmessen, Seen und Berge verschieben das deutlich.

**`TARGET_HM_PER_KM`** (1.5 / 3 / 5 / 8) gehört zu BRouters *gefilterten* Höhenmetern und
ist rund ein Drittel dessen, was ORS melden würde. Kein Tippfehler — Begründung und Messung
in ROUTING.md.

## Grenzen, die bekannt sind

- **„Nur Radnetz" ist eine Gewichtung, keine Sperre.** Führt kein beschilderter Weg zum
  nächsten Wegpunkt, nimmt BRouter die Straße. Der Regler gilt für beide Fahrprofile;
  beim Rennrad ist „Egal" voreingestellt, weil das Radnetz teils unbefestigt ist.
- **Stichfahrten sind stark reduziert, nicht weg.** Doppelt befahrene Strecke liegt jetzt
  bei rund 3–8 % statt 25 %. Restliche Umkehrpunkte entstehen dort, wo das Wegenetz keine
  Alternative hergibt.
- **Was in OSM fehlt, existiert fürs Routing nicht.** Ein aufgestelltes Schild ist keine
  Garantie für einen Eintrag im Radnetz.
- **Höhenmeter treffen nie exakt.** Deshalb vier Stufen statt einer Zahl.
- **Kurze Runden werden nicht bergig.** Um Radolfzell steigt hm/km mit der Distanz — eine
  25-km-Runde bleibt im flachen Seebecken, egal was der Regler sagt.
- **Lange Runden dauern.** 150 km brauchen rund 35 s, weil die Kandidaten sequenziell und
  mit Pause gegen einen Community-Server laufen. Der Fortschritt im Button ist echt.
- **`cycling-road` ist kein echtes Rennradprofil** (nur im ORS-Fallback relevant).
- **Kein Direktexport nach komoot.** komoot hat keine offene API (B2B-Partnervertrag nötig),
  also bleibt der GPX-Export. Den frisst komoot über „GPS-Datei importieren". Details in
  ROUTING.md.
- **Die Tempo-Stufen sind eigene Werte**, keine von komoot übernommenen — komoot
  veröffentlicht die km/h hinter seinen Fitnessleveln nicht.

## Bewusste Abweichung vom ursprünglichen Konzept

Im **Dauer-Modus** wird gegen die *Dauer* gefiltert und gescort, nicht gegen die aus der
Dauer abgeleitete Ersatzdistanz. Die Umrechnung ist nur eine Hilfsgröße für den Routing-Call;
über sie zu filtern warf genau die Kandidaten weg, die die Zeit am besten trafen (beste
Abweichung vorher 17 %, danach 1 %). Der Distanz-Modus bleibt unverändert. Umschaltpunkt ist
`primaryDeviation()` in [`lib/routing/candidates.ts`](lib/routing/candidates.ts).
