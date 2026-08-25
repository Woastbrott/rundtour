"use client";

import type { RouteCandidate } from "@/lib/ors/schema";
import { formatDuration } from "@/lib/routing/estimate";

type Props = {
  candidate: RouteCandidate;
  onExportGpx: () => void;
  onExportKomoot: () => void;
  /** Was beim letzten Komoot-Export passiert ist — bestimmt den Hinweistext. */
  komootHint: string | null;
};

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="min-w-0">
      <div className="t-label">{label}</div>
      {/* Kein truncate: lieber umbrechen als eine Kennzahl abschneiden. */}
      <div className="t-metric mt-0.5">
        {value}
        <span className="ml-0.5 text-[15px] font-medium text-ink-secondary">{unit}</span>
      </div>
    </div>
  );
}

const buttonClass =
  "flex shrink-0 items-center gap-1.5 rounded-[11px] px-3 py-2 text-[14px] font-medium transition-[transform,opacity] duration-150 ease-ios active:scale-[0.97] active:opacity-70";

export function RouteStats({ candidate, onExportGpx, onExportKomoot, komootHint }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {/*
        Kennzahlen bekommen die volle Breite. Die Export-Buttons standen früher
        daneben und haben die vier Spalten so schmal gedrückt, dass "29.5 km"
        zu "29…" abgeschnitten wurde.
      */}
      <div className="grid grid-cols-4 gap-3">
        <Metric label="Distanz" value={(candidate.distance / 1000).toFixed(1)} unit="km" />
        <Metric label="Dauer" value={formatDuration(candidate.durationH)} unit="" />
        <Metric label="Aufstieg" value={String(Math.round(candidate.ascent))} unit="hm" />
        <Metric label="Abstieg" value={String(Math.round(candidate.descent))} unit="hm" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onExportGpx} className={`${buttonClass} bg-sunken text-ink`}>
          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 fill-current">
            <path d="M8 1a.7.7 0 0 1 .7.7v7.2l2.3-2.29a.7.7 0 1 1 .99.99l-3.5 3.5a.7.7 0 0 1-.99 0l-3.5-3.5a.7.7 0 0 1 .99-.99L7.3 8.9V1.7A.7.7 0 0 1 8 1ZM2.7 11.3a.7.7 0 0 1 .7.7v1.3h9.2V12a.7.7 0 1 1 1.4 0v1.5a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 13.5V12a.7.7 0 0 1 .7-.7Z" />
          </svg>
          GPX
        </button>

        <button
          type="button"
          onClick={onExportKomoot}
          className={`${buttonClass} bg-accent text-accent-ink`}
        >
          An komoot senden
        </button>

        {komootHint ? (
          <p role="status" className="min-w-[12rem] flex-1 text-[12px] leading-snug text-ink-secondary">
            {komootHint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
