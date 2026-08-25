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
| `prefer` | `false` | `false` | Standardprofil `trekking` |
| `only` | `false` | `true` | Upload |

`prefer` ist exakt der Auslieferungszustand von `trekking.brf` und braucht deshalb keinen
Upload. Beim Rennrad-Profil ist der Regler ausgeblendet und der Wert serverseitig auf
`ignore` gezwungen — dort läuft das Standardprofil `fastbike`.

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

Abweichung vom Auftrag an einer Stelle: statt drei fertiger `.brf`-Dateien liegt **eine**
Vorlage im Repo (`profiles/trekking-base.brf`, unveränderte Kopie des Originals mit zwei
Platzhaltern). Die Varianten entstehen zur Laufzeit. Grund: drei fast identische
438-Zeilen-Dateien wären beim nächsten Upstream-Update dreimal zu pflegen.

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

Messung über Radolfzell:

| Faktor | Ist/Soll |
|---|---|
| 0.42 | 0.73 |
| 0.52 | 0.90 |
| 0.62 | 1.02 … 1.09 |

Gewählt: **0.58**. In einer anderen Gegend nachmessen — Seen und Berge verschieben das
deutlich.

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


### Offen: die Tabelle gilt nur fuer das Radtour-Profil

Ausgemessen wurde ausschliesslich mit `trekking`. Das Rennrad-Profil `fastbike` liegt
systematisch hoeher, weil es Strassen ueber die Huegel nimmt statt flacher Radwege:
gemessen 7.0 hm/km bei einer 60-km-Runde, wo `trekking` rund 3 hm/km liefert.

Folge: bei "Rennrad" ist die Hoehenstufe verschoben — "wellig" trifft eher das, was die
Tabelle als "bergig" fuehrt. Distanz und Dauer stimmen weiterhin.

Sauber waere eine Tabelle pro Fahrprofil (`Record<Profile, Record<Terrain, number>>`).
Bewusst nicht nebenbei geaendert, weil der Auftrag Scoring-nahe Werte ausdruecklich
ausgenommen hat.

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
