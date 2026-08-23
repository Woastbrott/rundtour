"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BottomSheet, type Detent } from "@/components/BottomSheet";
import { CandidateTabs } from "@/components/CandidateTabs";
import { ControlPanel, type TargetMode } from "@/components/ControlPanel";
import { ElevationProfile } from "@/components/ElevationProfile";
import { RouteMap, type MapPadding } from "@/components/RouteMap";
import { RouteStats } from "@/components/RouteStats";
import { downloadGpx } from "@/lib/gpx";
import type { GenerateResponse, LatLon, Position3, RouteCandidate } from "@/lib/ors/schema";
import { PROFILE_LABEL, TERRAIN_LABEL, type Profile, type Terrain } from "@/lib/routing/constants";

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

function errorFrom(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null && "error" in data && typeof data.error === "string") {
    return data.error;
  }
  return fallback;
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

  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hoverPoint, setHoverPoint] = useState<Position3 | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [detent, setDetent] = useState<Detent>("full");
  const [sheetHeight, setSheetHeight] = useState(168);

  const nonce = useRef(0);
  const inflight = useRef<AbortController | null>(null);

  const candidates: readonly RouteCandidate[] = result?.candidates ?? [];
  const active = candidates[selected] ?? null;

  const setStartPoint = useCallback((point: LatLon, label: string | null) => {
    setStart(point);
    setStartLabel(label);
    setLocationError(null);
    // Alte Vorschläge gehören zum alten Startpunkt.
    setResult(null);
    setSelected(0);
    setError(null);
    setHoverPoint(null);
  }, []);

  const generate = useCallback(async () => {
    if (!start) return;
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;

    nonce.current += 1;
    setLoading(true);
    setError(null);
    setHoverPoint(null);

    try {
      const response = await fetch("/api/routes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          start,
          profile,
          terrain,
          target: mode === "duration" ? { mode, minutes } : { mode, km },
          nonce: nonce.current,
        }),
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        setResult(null);
        setError(errorFrom(data, "Das Generieren hat nicht geklappt. Nochmal versuchen."));
        return;
      }

      const payload = data as GenerateResponse;
      setResult(payload);
      setSelected(0);
      if (compact) setDetent("peek");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setResult(null);
      setError("Keine Verbindung zum Server. Netz prüfen und nochmal versuchen.");
    } finally {
      if (inflight.current === controller) {
        inflight.current = null;
        setLoading(false);
      }
    }
  }, [start, profile, terrain, mode, minutes, km, compact]);

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
      onGenerate={generate}
      loading={loading}
      hasResults={candidates.length > 0}
      error={error}
    />
  );

  const results = active ? (
    <div className="flex flex-col gap-3.5">
      {result?.notice ? (
        <p className="t-body text-ink-secondary">{result.notice}</p>
      ) : null}
      <CandidateTabs
        candidates={candidates}
        selected={selected}
        onSelect={(index) => {
          setSelected(index);
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
        <BottomSheet
          detent={detent}
          onDetentChange={setDetent}
          onVisibleHeight={setSheetHeight}
        >
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
