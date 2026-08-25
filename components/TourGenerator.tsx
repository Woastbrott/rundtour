"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";

import { BottomSheet, type Detent } from "@/components/BottomSheet";
import { CandidateTabs } from "@/components/CandidateTabs";
import { ControlPanel, type TargetMode } from "@/components/ControlPanel";
import { ElevationProfile } from "@/components/ElevationProfile";
import { RouteMap, type MapPadding } from "@/components/RouteMap";
import { RouteStats } from "@/components/RouteStats";
import { downloadGpx } from "@/lib/gpx";
import type { LatLon, Position3, RouteCandidate } from "@/lib/ors/schema";
import type { NetworkPreference } from "@/lib/routing/adapter";
import type { GenerateEvent, Suggestion } from "@/lib/routing/candidates";
import {
  PROFILE_LABEL,
  RESULT_COUNT,
  TERRAIN_LABEL,
  type Profile,
  type Terrain,
} from "@/lib/routing/constants";

function useIsCompact(): boolean | null {
  const [compact, setCompact] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}

/** NDJSON zeilenweise auslesen — eine JSON-Zeile pro Ereignis. */
async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<GenerateEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as GenerateEvent;
      }
    }
    const rest = buffer.trim();
    if (rest) yield JSON.parse(rest) as GenerateEvent;
  } finally {
    reader.releaseLock();
  }
}

export function TourGenerator() {
  const compact = useIsCompact();

  const [start, setStart] = useState<LatLon | null>(null);
  const [startLabel, setStartLabel] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>("road");
  const [mode, setMode] = useState<TargetMode>("duration");
  const [minutes, setMinutes] = useState(120);
  const [km, setKm] = useState(45);
  const [terrain, setTerrain] = useState<Terrain>("wellig");

  /*
   * Der Netz-Regler wird pro Fahrprofil gemerkt. Grund: die sinnvolle
   * Voreinstellung unterscheidet sich — beim Rennrad will man das Radnetz
   * normalerweise nicht (unbefestigte Abschnitte), bei der Radtour schon.
   * Umschalten zwischen den Profilen soll die jeweils eigene Wahl wiederfinden,
   * statt sie zu überschreiben.
   */
  const [networkByProfile, setNetworkByProfile] = useState<Record<Profile, NetworkPreference>>({
    road: "ignore",
    tour: "prefer",
  });
  const networkPreference = networkByProfile[profile];
  const setNetworkPreference = useCallback(
    (value: NetworkPreference) => setNetworkByProfile((prev) => ({ ...prev, [profile]: value })),
    [profile],
  );

  const [candidates, setCandidates] = useState<RouteCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hoverPoint, setHoverPoint] = useState<Position3 | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [detent, setDetent] = useState<Detent>("full");
  const [sheetHeight, setSheetHeight] = useState(168);

  const nonce = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  /** Hat der Nutzer selbst eine Runde gewählt? Dann nicht mehr automatisch umschalten. */
  const pinned = useRef(false);

  // Beste drei, nach Score. Die Kandidaten trudeln einzeln ein, deshalb wird
  // hier sortiert und nicht auf die Reihenfolge im Stream vertraut.
  const ranked = useMemo(
    () => [...candidates].sort((a, b) => a.score - b.score).slice(0, RESULT_COUNT),
    [candidates],
  );
  const active = ranked.find((c) => c.id === selectedId) ?? ranked[0] ?? null;

  const clearResults = useCallback(() => {
    setCandidates([]);
    setSelectedId(null);
    setNotice(null);
    setSuggestion(null);
    setError(null);
    setHoverPoint(null);
    pinned.current = false;
  }, []);

  const setStartPoint = useCallback(
    (point: LatLon, label: string | null) => {
      setStart(point);
      setStartLabel(label);
      setLocationError(null);
      // Alte Vorschläge gehören zum alten Startpunkt.
      clearResults();
    },
    [clearResults],
  );

  const generate = useCallback(
    async (overrides?: { networkPreference?: NetworkPreference }) => {
      if (!start) return;
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;

      const network = overrides?.networkPreference ?? networkPreference;
      nonce.current += 1;

      clearResults();
      setLoading(true);
      setProgress(null);

      const collected: RouteCandidate[] = [];

      try {
        const response = await fetch("/api/routes/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            start,
            profile,
            terrain,
            networkPreference: network,
            target: mode === "duration" ? { mode, minutes } : { mode, km },
            nonce: nonce.current,
          }),
        });

        if (!response.ok || !response.body) {
          const fallback: unknown = await response.json().catch(() => null);
          setError(
            typeof fallback === "object" &&
              fallback !== null &&
              "error" in fallback &&
              typeof fallback.error === "string"
              ? fallback.error
              : "Das Generieren hat nicht geklappt. Nochmal versuchen.",
          );
          return;
        }

        for await (const event of readEvents(response.body)) {
          if (controller.signal.aborted) return;

          if (event.type === "progress") {
            setProgress({ done: event.done, total: event.total });
          } else if (event.type === "candidate") {
            collected.push(event.candidate);
            setCandidates([...collected]);
            // Solange der Nutzer nicht selbst gewählt hat, folgt die Auswahl dem Besten.
            if (!pinned.current) {
              const best = [...collected].sort((a, b) => a.score - b.score)[0];
              setSelectedId(best.id);
            }
          } else if (event.type === "result") {
            setNotice(event.notice ?? null);
            setSuggestion(event.suggestion ?? null);
            if (compact) setDetent("peek");
          } else if (event.type === "error") {
            setError(event.message);
            setSuggestion(event.suggestion ?? null);
          }
        }
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError("Die Verbindung ist abgerissen. Netz prüfen und nochmal versuchen.");
      } finally {
        if (inflight.current === controller) {
          inflight.current = null;
          setLoading(false);
          setProgress(null);
        }
      }
    },
    [start, profile, terrain, mode, minutes, km, networkPreference, compact, clearResults],
  );

  const applySuggestion = useCallback(() => {
    if (!suggestion) return;
    setNetworkPreference(suggestion.value);
    void generate({ networkPreference: suggestion.value });
  }, [suggestion, generate, setNetworkPreference]);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocationError("Dein Browser gibt den Standort nicht her.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setStartPoint(
          { lat: position.coords.latitude, lon: position.coords.longitude },
          "Mein Standort",
        );
      },
      (cause) => {
        setLocating(false);
        setLocationError(
          cause.code === cause.PERMISSION_DENIED
            ? "Standortzugriff ist blockiert — setz den Start per Klick auf die Karte."
            : "Standort konnte nicht bestimmt werden. Setz den Start per Klick auf die Karte.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [setStartPoint]);

  const exportGpx = useCallback(() => {
    if (!active) return;
    downloadGpx(
      active,
      `Rundtour ${(active.distance / 1000).toFixed(0)} km · ${PROFILE_LABEL[profile]} · ${TERRAIN_LABEL[terrain]}`,
    );
  }, [active, profile, terrain]);

  const padding: MapPadding = useMemo(
    () =>
      compact
        ? { top: 28, right: 28, bottom: Math.min(sheetHeight, 380) + 24, left: 28 }
        : { top: 40, right: 40, bottom: active ? 250 : 48, left: 420 },
    [compact, sheetHeight, active],
  );

  const controls = (
    <ControlPanel
      start={start}
      startLabel={startLabel}
      onStartPick={(point, label) => setStartPoint(point, label)}
      onLocate={locate}
      locating={locating}
      locationError={locationError}
      profile={profile}
      onProfileChange={setProfile}
      mode={mode}
      onModeChange={setMode}
      minutes={minutes}
      onMinutesChange={setMinutes}
      km={km}
      onKmChange={setKm}
      terrain={terrain}
      onTerrainChange={setTerrain}
      networkPreference={networkPreference}
      onNetworkChange={setNetworkPreference}
      onGenerate={() => void generate()}
      loading={loading}
      progress={progress}
      hasResults={ranked.length > 0}
      error={error}
      suggestion={suggestion ? { label: suggestion.label, onApply: applySuggestion } : null}
    />
  );

  const results = active ? (
    <div className="flex flex-col gap-3.5">
      {notice ? <p className="t-body text-ink-secondary">{notice}</p> : null}
      <CandidateTabs
        candidates={ranked}
        selected={Math.max(
          0,
          ranked.findIndex((c) => c.id === active.id),
        )}
        onSelect={(index) => {
          pinned.current = true;
          setSelectedId(ranked[index].id);
          setHoverPoint(null);
        }}
      />
      <RouteStats candidate={active} onExport={exportGpx} />
      {/* key: neue Route -> frische Komponente, kein Hover-Rest von der vorigen. */}
      <ElevationProfile key={active.id} candidate={active} onHover={setHoverPoint} />
    </div>
  ) : null;

  return (
    <main className="relative h-full w-full">
      <RouteMap
        start={start}
        onStartChange={(point) => setStartPoint(point, null)}
        route={active}
        hoverPoint={hoverPoint}
        padding={padding}
      />

      {/* Desktop: Steuerung links, Ergebnis unten — beides schwebend über der Karte. */}
      {compact === false ? (
        <>
          <div className="pointer-events-none absolute top-5 bottom-5 left-5 z-10 flex w-[368px] flex-col">
            <div className="material animate-panel-in pointer-events-auto flex max-h-full flex-col overflow-y-auto overscroll-contain rounded-panel p-5">
              <h1 className="t-display mb-4">Rundtour</h1>
              {controls}
            </div>
          </div>

          {results ? (
            <div className="pointer-events-none absolute right-5 bottom-5 left-[404px] z-10 flex justify-center">
              <div className="material animate-panel-in pointer-events-auto w-full max-w-2xl rounded-panel p-4">
                {results}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* Mobil: ein Sheet mit zwei Rastpunkten. */}
      {compact === true ? (
        <BottomSheet detent={detent} onDetentChange={setDetent} onVisibleHeight={setSheetHeight}>
          <div className="flex flex-col gap-4">
            {results}
            {results ? <hr className="border-separator" /> : null}
            {controls}
          </div>
        </BottomSheet>
      ) : null}
    </main>
  );
}
