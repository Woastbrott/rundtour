"use client";

import { PlaceSearch } from "@/components/PlaceSearch";
import { Segmented } from "@/components/ui/Segmented";
import { Slider } from "@/components/ui/Slider";
import type { NetworkPreference } from "@/lib/routing/adapter";
import type { LatLon } from "@/lib/ors/schema";
import {
  DISTANCE_RANGE_KM,
  DURATION_RANGE_MIN,
  TERRAINS,
  TERRAIN_LABEL,
  type Profile,
  type Terrain,
} from "@/lib/routing/constants";
import { formatDuration } from "@/lib/routing/estimate";

export type TargetMode = "duration" | "distance";

type Props = {
  start: LatLon | null;
  startLabel: string | null;
  onStartPick: (point: LatLon, label: string) => void;
  onLocate: () => void;
  locating: boolean;
  locationError: string | null;

  profile: Profile;
  onProfileChange: (profile: Profile) => void;

  mode: TargetMode;
  onModeChange: (mode: TargetMode) => void;

  minutes: number;
  onMinutesChange: (minutes: number) => void;
  km: number;
  onKmChange: (km: number) => void;

  terrain: Terrain;
  onTerrainChange: (terrain: Terrain) => void;

  networkPreference: NetworkPreference;
  onNetworkChange: (preference: NetworkPreference) => void;

  onGenerate: () => void;
  loading: boolean;
  /** Wie viele Runden schon durch sind — nur gesetzt, solange gerechnet wird. */
  progress: { done: number; total: number } | null;
  hasResults: boolean;
  error: string | null;
  /** Direkt ausführbarer Ausweg, wenn der Netz-Regler zu streng war. */
  suggestion: { label: string; onApply: () => void } | null;
};

const PROFILE_OPTIONS = [
  { value: "road", label: "Rennrad" },
  { value: "tour", label: "Radtour" },
] as const satisfies ReadonlyArray<{ value: Profile; label: string }>;

const MODE_OPTIONS = [
  { value: "duration", label: "Dauer" },
  { value: "distance", label: "Distanz" },
] as const satisfies ReadonlyArray<{ value: TargetMode; label: string }>;

const TERRAIN_TICKS = TERRAINS.map((t) => TERRAIN_LABEL[t]);

/*
 * Kurze Segment-Labels, ausführliche Erklärung darunter — in einem 340-px-Panel
 * passen "Beschilderte bevorzugen" und "Möglichst nur beschilderte" nicht
 * nebeneinander. Der Hilfetext sagt dafür ehrlich, was die Stufe bedeutet.
 */
const NETWORK_OPTIONS = [
  { value: "ignore", label: "Egal" },
  { value: "prefer", label: "Bevorzugen" },
  { value: "only", label: "Nur Radnetz" },
] as const satisfies ReadonlyArray<{ value: NetworkPreference; label: string }>;

const NETWORK_HELP: Record<NetworkPreference, string> = {
  ignore: "Beste Strecke, egal ob beschildert.",
  prefer: "Nutzt die Radwegweiser, weicht aber ab, wenn es sich lohnt.",
  // Kein Versprechen: stick_to_cycleroutes ist eine starke Gewichtung, keine Sperre.
  only: "Bleibt möglichst auf dem beschilderten Radnetz — kann längere Umwege bedeuten.",
};

/**
 * Zusatz nur fürs Rennrad: das Radnetz führt streckenweise über Wege, die man
 * mit schmalen Reifen nicht fahren will. Das gehört gesagt, statt es dem Nutzer
 * unterwegs zu überlassen.
 */
const NETWORK_ROAD_CAVEAT = "Achtung: Das Radnetz führt teils über unbefestigte Abschnitte.";

export function ControlPanel(props: Props) {
  const {
    start,
    startLabel,
    onStartPick,
    onLocate,
    locating,
    locationError,
    profile,
    onProfileChange,
    mode,
    onModeChange,
    minutes,
    onMinutesChange,
    km,
    onKmChange,
    terrain,
    onTerrainChange,
    networkPreference,
    onNetworkChange,
    onGenerate,
    loading,
    progress,
    hasResults,
    error,
    suggestion,
  } = props;

  const terrainIndex = TERRAINS.indexOf(terrain);

  return (
    <div className="flex flex-col gap-5">
      {/* Start ---------------------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <h2 className="t-label">Start</h2>
        <PlaceSearch onPick={onStartPick} focus={start} />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onLocate}
            disabled={locating}
            className="flex items-center gap-1.5 rounded-[9px] px-2 py-1 text-[13px] font-medium text-accent transition-opacity duration-150 active:opacity-55 disabled:opacity-40"
          >
            <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 fill-current">
              <path d="M8 0a.6.6 0 0 1 .6.6v1.44a6 6 0 0 1 5.36 5.36h1.44a.6.6 0 0 1 0 1.2h-1.44a6 6 0 0 1-5.36 5.36v1.44a.6.6 0 0 1-1.2 0v-1.44A6 6 0 0 1 2.04 8.6H.6a.6.6 0 0 1 0-1.2h1.44A6 6 0 0 1 7.4 2.04V.6A.6.6 0 0 1 8 0Zm0 3.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Zm0 2.6a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z" />
            </svg>
            {locating ? "Suche Standort…" : "Mein Standort"}
          </button>

          {start ? (
            <span className="min-w-0 flex-1 truncate text-right text-[12px] text-ink-secondary tabular-nums">
              {startLabel ?? `${start.lat.toFixed(4)}, ${start.lon.toFixed(4)}`}
            </span>
          ) : null}
        </div>

        {locationError ? <p className="text-[12px] text-route">{locationError}</p> : null}
        {!start ? (
          <p className="t-body text-ink-secondary">
            Tipp auf die Karte, such einen Ort oder nimm deinen Standort. Start und Ziel sind
            derselbe Punkt.
          </p>
        ) : null}
      </section>

      <hr className="border-separator" />

      {/* Parameter ------------------------------------------------------ */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="t-label">Profil</h2>
          <Segmented
            label="Fahrprofil"
            options={PROFILE_OPTIONS}
            value={profile}
            onChange={onProfileChange}
          />
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="t-label">Zielgröße</h2>
          <Segmented
            label="Ziel nach Dauer oder Distanz"
            options={MODE_OPTIONS}
            value={mode}
            onChange={onModeChange}
          />
        </div>

        {mode === "duration" ? (
          <Slider
            label="Fahrzeit"
            display={formatDuration(minutes / 60)}
            min={DURATION_RANGE_MIN.min}
            max={DURATION_RANGE_MIN.max}
            step={15}
            value={minutes}
            onChange={onMinutesChange}
          />
        ) : (
          <Slider
            label="Distanz"
            display={`${km} km`}
            min={DISTANCE_RANGE_KM.min}
            max={DISTANCE_RANGE_KM.max}
            step={5}
            value={km}
            onChange={onKmChange}
          />
        )}

        <Slider
          label="Höhenprofil"
          display={TERRAIN_LABEL[terrain]}
          min={0}
          max={TERRAINS.length - 1}
          step={1}
          value={terrainIndex}
          onChange={(i) => onTerrainChange(TERRAINS[i])}
          ticks={TERRAIN_TICKS}
        />

        <div className="flex flex-col gap-2">
          <h2 className="t-label">Beschilderte Radwege</h2>
          <Segmented
            label="Wie stark den Radwegweisern folgen"
            options={NETWORK_OPTIONS}
            value={networkPreference}
            onChange={onNetworkChange}
          />
          <p className="text-[12px] leading-snug text-ink-secondary">
            {NETWORK_HELP[networkPreference]}
            {profile === "road" && networkPreference !== "ignore" ? (
              <span className="mt-1 block">{NETWORK_ROAD_CAVEAT}</span>
            ) : null}
          </p>
        </div>
      </section>

      {/* Aktion --------------------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={!start || loading}
          aria-live="polite"
          className="relative w-full overflow-hidden rounded-[13px] bg-accent px-4 py-3 text-[16px] font-semibold tracking-[-0.01em] text-accent-ink transition-[transform,opacity] duration-150 ease-ios active:scale-[0.985] active:opacity-90 disabled:pointer-events-none disabled:opacity-60"
        >
          {/*
            Fortschrittsbalken im Button statt daneben: die Runden laufen
            sequenziell gegen einen fremden Server, das dauert. Ohne echten
            Fortschritt sieht die Wartezeit nach Absturz aus.
          */}
          {loading && progress ? (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-300 ease-ios"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          ) : null}
          <span className="relative">
            {loading
              ? progress
                ? `Runde ${progress.done} von ${progress.total}…`
                : "Suche Runden…"
              : hasResults
                ? "Neu würfeln"
                : "Touren generieren"}
          </span>
        </button>

        {error ? (
          <p role="alert" className="t-body text-route">
            {error}
          </p>
        ) : null}

        {suggestion ? (
          <button
            type="button"
            onClick={suggestion.onApply}
            className="w-full rounded-[11px] bg-sunken px-4 py-2.5 text-[14px] font-medium text-accent transition-[transform,opacity] duration-150 ease-ios active:scale-[0.985] active:opacity-70"
          >
            Auf „{suggestion.label}“ wechseln und neu suchen
          </button>
        ) : null}
      </section>
    </div>
  );
}
