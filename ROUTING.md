# Routing

Zwei Engines hinter einem Interface (`lib/routing/adapter.ts`). Welche läuft, entscheidet
`ROUTING_ENGINE` — `brouter` (Default) oder `ors`.

| | BRouter | ORS |
|---|---|---|
| API-Key | nein | ja (`ORS_API_KEY`) |
| Netz-Regler | ja, drei Stufen | **nein**, `only` wirft einen Fehler |
| Rundtour | eigene Wegpunkte (`lib/routing/loop.ts`) | dieselben Wegpunkte, `round_trip` wird nicht mehr benutzt |
| Höhenmeter | `filtered ascend` | `ascent` (ungefiltert) |

Die Ortssuche hängt unabhängig davon immer an ORS-Geocoding und braucht den Key.

---

## Wie der Netz-Regler umgesetzt ist

Die drei Stufen entstehen aus zwei Variablen in BRouters `trekking.brf`:

| Stufe | `ignore_cycleroutes` | `stick_to_cycleroutes` | Profil |
|---|---|---|---|
| `ignore` | `true` | `false` | Upload |
| `prefer` | `false` | `false` | Upload |
| `only` | `false` | `true` | Upload |

Der Regler gilt für **beide** Fahrprofile. `fastbike.brf` bringt die zwei Variablen im
Original nicht mit — sie sind in `profiles/fastbike-base.brf` ergänzt, zusammen mit der
passenden Erweiterung der Kostenkette (`is_ldcr`), 1:1 nach dem Muster aus `trekking.brf`.

Voreinstellung je Profil, im Client gemerkt: **Rennrad `ignore`**, **Radtour `prefer`**.
Beim Rennrad will man das Radnetz normalerweise nicht, weil es streckenweise über
unbefestigte Abschnitte führt; der Hilfetext sagt das auch, sobald dort etwas anderes als
`ignore` gewählt ist. Umschalten zwischen den Profilen behält die jeweils eigene Wahl.

Es gibt keine Abkürzung über Standardprofile: unsere Vorlagen weichen auch abseits des
Reglers vom Original ab (siehe unten), also werden alle sechs Kombinationen hochgeladen und
im Speicher gehalten.

### Warum Upload und nicht Query-Parameter

Der Auftrag sah eine Kaskade aus drei Wegen vor. Ergebnis der Prüfung am 24.08.2026:

**A) Profilvariablen per Query-Parameter — funktioniert nicht.**
`ServerHandler.java` dokumentiert in Zeile 32 `profile:xxx = parameter in profile`. Gegen
`brouter.de` antwortet jede Variante mit **HTTP 500**, unabhängig von der Variable und
davon, ob der Doppelpunkt URL-kodiert ist. Getestet mit `profile:stick_to_cycleroutes`,
`profile%3Astick_to_cycleroutes` und `profile:allow_ferries`. Ausgeschieden.

**B) Eigene Profile hochladen — gewählt.**
`POST https://brouter.de/brouter/profile` nimmt ein `.brf` entgegen und gibt
`{"profileid":"custom_1787675915615"}` zurück. Verifiziert: drei Uploads ergaben drei
nachweislich verschiedene Geometrien (Kosten 44417 / 51782 / 48703 auf identischen
Wegpunkten).

**C) Reduktion auf zwei Stufen — nicht nötig.**
War als Rückfallebene gedacht, falls nur `trekking`s eingebauter Schalter zur Verfügung
steht. Da (B) funktioniert, gibt es drei echte Stufen.

Abweichung vom Auftrag an einer Stelle: statt fertiger `.brf`-Dateien pro Stufe liegen
**zwei Vorlagen** im Repo — `profiles/trekking-base.brf` und `profiles/fastbike-base.brf`,
je eine Kopie des Originals mit Platzhaltern. Die sechs Varianten entstehen zur Laufzeit.
Grund: sechs fast identische 400-Zeilen-Dateien wären beim nächsten Upstream-Update sechsmal
zu pflegen. Jede Abweichung vom Original ist in den Dateien mit „von Rundtour ergaenzt"
markiert und im Kopf aufgeführt.

Die Profil-IDs liegen ebenfalls nicht in der Env, sondern werden bei Bedarf hochgeladen und
im Speicher gehalten (`lib/brouter/profiles.ts`). Sie sehen nach Zeitstempeln aus und es gibt
keine Zusage, dass `brouter.de` sie dauerhaft behält — deshalb Neu-Upload bei Fehlschlag.
Nebeneffekt: die App braucht für das Routing gar keine Env-Variable.

### Was `only` nicht ist

Eine **Gewichtung, keine Sperre.** `stick_to_cycleroutes` erhöht im Profil die Kosten für
alles abseits des Netzes (Faktor 0.5 statt 0.05), verbietet es aber nicht. Führt kein
beschilderter Weg zum nächsten Wegpunkt, nimmt BRouter die Straße. Das UI-Label sagt
deshalb „Bleibt **möglichst** auf dem beschilderten Radnetz".

Was BRouter als Radnetz zählt (`trekking.brf`, Zeile 86 f.):

```
assign is_cycleroute =
     if any_cycleroute then true     # Relationen: route_bicycle_lcn/rcn/ncn/icn
     else lcn=yes                    # oder das Tag direkt am Weg
```

Beides zusammen deckt sowohl benannte Routen als auch die schlichte Zielwegweisung ab. Im
Raum Radolfzell / Höri / Untersee sind das laut Overpass 131 Wege mit `lcn=yes` und 246
Radrouten-Relationen (227 lokal, 13 regional, 6 international) — darunter Hegau-Route,
Drei-Welten-Radweg, Bodensee-Radweg, EuroVelo 6 und 15.

Was in OSM nicht erfasst ist, existiert fürs Routing nicht. Ein aufgestelltes Schild ist
keine Garantie für einen Eintrag.

---

## Rundtour ohne `round_trip`

BRouter kennt kein `round_trip`, also erzeugt `lib/routing/loop.ts` die Wegpunkte selbst:
ein gejitterter Ring aus fünf Punkten um den Start, Start am Anfang und am Ende. Der Zufall
läuft über einen seed-basierten PRNG (mulberry32), damit dieselbe Anfrage dieselbe Runde
ergibt.

**`LOOP_RADIUS_FACTOR` ist die wichtigste Stellschraube.** Der Auftrag nannte 1.15 als
Startwert; gemessen ergab das die **2,2-fache** Zieldistanz. Der Denkfehler: der Start liegt
im Zentrum des Rings, der Weg ist also einmal Radius raus, vier Sehnen, einmal Radius zurück
— geometrisch rund 6.7·r statt 2π·r.

Der Faktor musste nach dem Einbau der Umweg-Korrektur (siehe unten) noch einmal deutlich
hoch, weil die Korrektur Strecke wegschneidet — und zwar nichtlinear: bei kleinem Ring
landen mehr Wegpunkte im Nirgendwo, und mehr wird getrimmt.

Messung über Radolfzell, beide Profile, Ziele 30–80 km:

| Faktor | Ist/Soll |
|---|---|
| 0.58 | 0.61 |
| 0.66 | 1.06 |
| **0.72** | **1.01 … 1.03** |
| 0.80 | 1.18 … 1.29 |

Gewählt: **0.72**. In einer anderen Gegend nachmessen — Seen und Berge verschieben das
deutlich.

**`LOOP_POINTS = 5` ist ebenfalls gemessen, nicht geraten.** Die naheliegende Annahme, mehr
Ringpunkte würden die Runde runder machen, stimmt nicht — sie machen es messbar schlechter,
weil jeder zusätzliche Punkt eine weitere Chance ist, abseits des Wegenetzes zu landen und
eine Stichfahrt zu erzwingen:

| Ringpunkte | doppelt befahren Ø | max | Ist/Soll |
|---|---|---|---|
| **5** | **2.6 %** | 6.5 % | 0.97 |
| 7 | 4.6 % | 13.4 % | 1.16 |
| 9 | 7.8 % | 13.9 % | 1.44 |

---

## Keine Faehren, keine Stichfahrten

Zwei Aenderungen an beiden Profil-Vorlagen, beide gemessen statt vermutet.

### `allow_ferries = false`

Runden fuehrten quer ueber den Bodensee. Nachgewiesen ueber die `messages` der
GeoJSON-Antwort, die die Way-Tags jedes Segments mitliefert: bei 6 Testrunden enthielten
**3** Faehrsegmente, eine davon **4,7 km ueber Wasser** (`foot=yes bicycle=yes route=ferry`).

Wichtig ist dabei die Reihenfolge in der Kostenkette. In `trekking.brf` steht die
Faehrenpruefung vor der Radrouten-Regel; in `fastbike.brf` musste sie beim Einbau von
`is_ldcr` bewusst davor gesetzt werden. Andernfalls bekaeme eine Faehre, die Teil einer
Radroute ist — am Bodensee die Regel, nicht die Ausnahme — ueber `is_ldcr` Kosten 1.0 und
wuerde `allow_ferries` schlicht umgehen.

### `correctMisplacedViaPoints = true`, `...Distance = 0`

Unsere Ringpunkte liegen per Konstruktion an zufaelligen Stellen, oft abseits jeder Strasse.
BRouter routet dann zum naechsten erreichbaren Punkt und denselben Weg wieder zurueck — das
ist das "faehrt in eine Strasse rein und dreht einfach um".

Als Kennzahl: Anteil der Strecke, der in beiden Richtungen befahren wird.

| Einstellung | doppelt befahren Ø |
|---|---|
| Original (Korrektur aus) | 24.7 % |
| Korrektur an, Distance 400 (Default) | 24.7 % |
| **Korrektur an, Distance 0 (unbegrenzt)** | **3.9 %** |

Der Default-Wert 400 m bringt nichts, weil unsere Stichfahrten deutlich laenger sind. Erst
`0` — laut Doku "removes detours whatever their length" — greift.

Preis: die Korrektur schneidet Strecke weg, die Runden wurden rund 35 % kuerzer. Deshalb der
neu gemessene `LOOP_RADIUS_FACTOR`. Ueber die App gemessen liegt der Anteil jetzt bei 0.5 bis
8.5 % je nach Kombination, im Mittel rund 5 %.
---

## Höhenmeter: die Skala hat sich verschoben

BRouter liefert `filtered ascend`, ORS lieferte ungefilterte Werte. Für dieselbe 40-km-Runde:
ORS 500–700 hm, BRouter gefiltert **162 hm**, BRouter roh aus der Geometrie 346 hm. Verhältnis
roh/gefiltert im Mittel **1.74**.

`TARGET_HM_PER_KM` musste deshalb mitwandern — die alten Werte wären unerreichbar gewesen:

| Stufe | vorher (ORS) | jetzt (BRouter gefiltert) |
|---|---|---|
| flach | 3 | 1.5 |
| wellig | 8 | 3 |
| hügelig | 15 | 5 |
| bergig | 25 | 8 |

Neu ausgemessen an 16 Runden zwischen 25 und 100 km um Radolfzell: 1.6 bis 9.7 hm/km,
Median ~4.9. `HM_SCORE_FLOOR` ging von 5 auf 2 mit, sonst hätte die Untergrenze den
Höhenterm für die unteren drei Stufen eingeebnet.

**Scoring-Formel und Gewichte sind unverändert.** Geändert wurden nur die Zielwerte, gegen
die gemessen wird.

Eine Eigenheit der Gegend, die man in den Ergebnissen sieht: hm/km steigt mit der Distanz.
Kurze Runden bleiben im flachen Seebecken, lange greifen in den Hegau aus. Eine 25-km-Runde
wird um Radolfzell nie „bergig", egal was der Regler sagt.


### Zur Tabelle und den zwei Fahrprofilen

Ursprünglich wurde nur mit `trekking` ausgemessen, und `fastbike` lag deutlich höher —
gemessen 7.0 gegen rund 3.0 hm/km. Damit war die Höhenstufe beim Rennrad verschoben.

Seit `fastbike-base.brf` dieselbe Radrouten-Logik hat, ist die Lücke weitgehend zu:
gemessen 3.6 (Rennrad) gegen 4.7 hm/km (Radtour) bei identischen Zielen, und über die App
überlappen die Bereiche (Rennrad 3.0–7.1, Radtour 3.7–10.6). Eine gemeinsame Tabelle ist
damit vertretbar.

Ganz sauber wäre trotzdem eine Tabelle pro Fahrprofil
(`Record<Profile, Record<Terrain, number>>`). Offen gelassen, weil der Rest-Unterschied
kleiner ist als die Streuung zwischen einzelnen Runden.

### Nebenwirkung auf den ORS-Fallback

Die Stufentabelle ist auf BRouters gefilterte Werte geeicht. Läuft die App mit
`ROUTING_ENGINE=ors`, liefert ORS für dieselbe Gegend rund das Dreifache — gemessen 11 hm/km
dort, wo BRouter 3 hm/km meldet. Der Höhen-Regler ist im ORS-Modus damit **verschoben**: die
Distanz stimmt weiterhin, die Höhenstufe trifft nicht mehr.

Bewusst so gelassen. ORS ist die Rückfallebene für den Fall, dass brouter.de ausfällt; dann
ist „Routen kommen überhaupt" wichtiger als eine exakt getroffene Höhenstufe. Wer ORS
dauerhaft fahren will, braucht eine zweite Tabelle pro Engine.

---

## Fairness gegenüber brouter.de

Der öffentliche Server ist ein Community-Dienst ohne Zusage und ohne Bezahlung.

- **Kein Auto-Generieren.** Slider lösen nichts aus, nur der explizite Klick.
- **Sequenziell**, nie parallel, mit 900 ms Pause zwischen den Anfragen
  (`BROUTER_REQUEST_GAP_MS`).
- **5 Kandidaten** statt vorher 8, ein Nachschlag von 3 nur wenn nötig.
- **Cache** über 10 Minuten auf die komplette NDJSON-Antwort; Startpunkt auf ~50 m gerundet,
  damit minimale Kartenklicks keinen neuen Durchlauf auslösen.
- **Eigener User-Agent** mit Projekt-URL.
- **20 s Timeout** pro Anfrage. Der Server bricht schwere Suchen selbst mit
  `operation killed by thread-priority-watchdog` ab; einzelne Runden brauchten aber auch
  schon ~17 s und kamen durch.

Ein Klick kostet damit 5 Anfragen, mit Nachschlag 8. Gemessene Gesamtdauer für 5 Kandidaten:
rund 5 Sekunden, erste Route auf der Karte nach ~300 ms.

---

## Warum die Antwort gestreamt wird

Der Route Handler antwortet als **NDJSON**, eine JSON-Zeile pro Ereignis
(`progress`, `candidate`, `result`, `error`). Sequenzielle Anfragen mit Pause dauern je nach
Gegend 5 bis 25 Sekunden — eine einzelne Antwort am Ende wäre ein Spinner ohne Rückmeldung.
So steht die erste Route nach ~300 ms auf der Karte, während die restlichen noch laufen, und
der Button zeigt echten Fortschritt statt einer erfundenen Zahl.

Der Client sortiert selbst nach Score und zeigt die besten drei; die Reihenfolge im Stream
ist die Ankunftsreihenfolge, nicht die Rangfolge.

---

## Tempo-Stufen

Vier Stufen (`gemuetlich` / `normal` / `sportlich` / `profi`), pro Fahrprofil eigene Werte in
`PACE_SPEED_KMH` und `PACE_CLIMB_MH`. Voreinstellung `normal`, im Client pro Fahrprofil
gemerkt — 24 km/h heisst beim Rennrad "normal", bei der Radtour waere es jenseits von "Profi".

Die km/h stehen im UI mit dran. "Profi" allein sagt niemandem, ob das 28 oder 35 sind; so
kann man die Stufe gegen den eigenen Schnitt abgleichen.

**Die Zahlen sind eigene, keine von komoot.** komoot veroeffentlicht die km/h hinter seinen
fuenf Fitnessleveln nicht. Das Prinzip ist aber dasselbe, komoot dazu: *"your fitness level
will not affect the route komoot generates for you. It will only adjust the estimated time."*

Genauso hier: die Stufe aendert nur `estimateDurationHours`. Im **Distanz-Modus** wirkt sie
deshalb nur auf die angezeigte Dauer. Im **Dauer-Modus** wirkt sie sehr wohl aufs Ergebnis,
weil aus der Zielzeit die Zieldistanz abgeleitet wird — gemessen bei Ziel 2 h, Rennrad:

| Stufe | beste Runde |
|---|---|
| gemuetlich | 34.5 km |
| normal | 35.0 km |
| sportlich | 43.1 km |
| profi | 44.9 km |


---

## Warum es keinen komoot-Export gibt

War angefragt, ist aber nicht baubar: **komoot hat keine offene API.** Der offizielle
OAuth-Beispielcode im komoot-GitHub sagt dazu *"To use this demo code you need valid oauth2
credentials. You can apply for them here: komoot.de/b2b/connect"* — also ein
B2B-Partnervertrag. Ohne den ist ein Server-zu-Server-Upload nicht moeglich.

Ein Umweg ueber die GPX-Datei war kurz eingebaut (Web Share API am Handy, Download plus
`komoot.com/upload` am Desktop) und auf Wunsch wieder entfernt. Bleibt der GPX-Export, den
komoot ueber "GPS-Datei importieren" frisst.
