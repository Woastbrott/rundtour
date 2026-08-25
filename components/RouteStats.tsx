"use client";

import type { RouteCandidate } from "@/lib/ors/schema";
import { formatDuration } from "@/lib/routing/estimate";

type Props = {
  candidate: RouteCandidate;
  onExportGpx: () => void;
};

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="min-w-0">
      <div className="t-label">{label}</div>
      {/* Kein truncate: lieber umbrechen als eine Kennzahl abschneiden. */}
      <div className="t-metric mt-0.5">
        {value}
        <span className="ml-0.5 text-[13px] font-medium text-ink-secondary md:text-[15px]">
          {unit}
        </span>
      </div>
    </div>
  );
}

export function RouteStats({ candidate, onExportGpx }: Props) {
  return (
    /*
     * Auf dem Handy passen vier Kennzahlen *und* der Knopf nicht in eine Zeile —
     * die Zahlen liefen sonst ineinander. Der Knopf bekommt darunter eine eigene
     * Zeile und damit nebenbei eine Trefferfläche, die man mit dem Daumen findet.
     */
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-4">
      <div className="grid min-w-0 grid-cols-4 gap-2 md:flex-1 md:gap-3">
        <Metric label="Distanz" value={(candidate.distance / 1000).toFixed(1)} unit="km" />
        <Metric label="Dauer" value={formatDuration(candidate.durationH)} unit="" />
        <Metric label="Aufstieg" value={String(Math.round(candidate.ascent))} unit="hm" />
        <Metric label="Abstieg" value={String(Math.round(candidate.descent))} unit="hm" />
      </div>

      <button
        type="button"
        onClick={onExportGpx}
        className="flex w-full shrink-0 items-center justify-center gap-1.5 rounded-[11px] bg-sunken px-3 py-2.5 text-[14px] font-medium text-ink transition-[transform,opacity] duration-150 ease-ios active:scale-[0.97] active:opacity-70 md:w-auto md:py-2"
      >
        <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 fill-current">
          <path d="M8 1a.7.7 0 0 1 .7.7v7.2l2.3-2.29a.7.7 0 1 1 .99.99l-3.5 3.5a.7.7 0 0 1-.99 0l-3.5-3.5a.7.7 0 0 1 .99-.99L7.3 8.9V1.7A.7.7 0 0 1 8 1ZM2.7 11.3a.7.7 0 0 1 .7.7v1.3h9.2V12a.7.7 0 1 1 1.4 0v1.5a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 13.5V12a.7.7 0 0 1 .7-.7Z" />
        </svg>
        GPX
      </button>
    </div>
  );
}
