"use client";

import type { RouteCandidate } from "@/lib/ors/schema";

type Props = {
  candidates: readonly RouteCandidate[];
  selected: number;
  onSelect: (index: number) => void;
};

export function CandidateTabs({ candidates, selected, onSelect }: Props) {
  if (candidates.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label="Vorgeschlagene Runden"
      className="relative isolate flex gap-0 rounded-[12px] bg-sunken p-[3px]"
    >
      <span
        aria-hidden
        className="absolute inset-y-[3px] left-[3px] -z-10 rounded-[9px] bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-transform duration-300 ease-ios"
        style={{
          width: `calc((100% - 6px) / ${candidates.length})`,
          transform: `translateX(${selected * 100}%)`,
        }}
      />

      {candidates.map((candidate, i) => {
        const active = i === selected;
        return (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(i)}
            className={`flex-1 rounded-[9px] px-2 py-1.5 transition-colors duration-200 ${
              active ? "text-ink" : "text-ink-secondary hover:text-ink"
            }`}
          >
            <span className="block text-[13px] font-semibold tabular-nums tracking-[-0.01em]">
              {(candidate.distance / 1000).toFixed(0)} km
            </span>
            <span className="block text-[11px] tabular-nums">
              {Math.round(candidate.ascent)} hm
            </span>
          </button>
        );
      })}
    </div>
  );
}
