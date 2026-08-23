"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Position3, RouteCandidate } from "@/lib/ors/schema";
import { cumulativeKm } from "@/lib/routing/geo";

type Props = {
  candidate: RouteCandidate;
  onHover: (point: Position3 | null) => void;
};

const HEIGHT = 92;
const PAD_TOP = 10;
const PAD_BOTTOM = 16;
const MAX_SAMPLES = 320;

/** Nächstgelegener Index zu einer Kilometer-Position — die Liste ist sortiert. */
function nearestIndex(cum: readonly number[], km: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < km) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(cum[lo - 1] - km) <= Math.abs(cum[lo] - km)) return lo - 1;
  return lo;
}

export function ElevationProfile({ candidate, onHover }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; km: number; ele: number } | null>(null);

  const model = useMemo(() => {
    const cum = cumulativeKm(candidate.coordinates);
    const totalKm = cum[cum.length - 1] || candidate.distance / 1000;

    let min = Infinity;
    let max = -Infinity;
    for (const [, , ele] of candidate.coordinates) {
      if (ele < min) min = ele;
      if (ele > max) max = ele;
    }
    // Mindestspanne, damit eine flache Runde nicht wie ein Erdbeben aussieht.
    if (max - min < 40) {
      const mid = (max + min) / 2;
      min = mid - 20;
      max = mid + 20;
    }

    const stride = Math.max(1, Math.ceil(candidate.coordinates.length / MAX_SAMPLES));
    const samples: Array<{ km: number; ele: number }> = [];
    for (let i = 0; i < candidate.coordinates.length; i += stride) {
      samples.push({ km: cum[i], ele: candidate.coordinates[i][2] });
    }
    const last = candidate.coordinates.length - 1;
    if (samples[samples.length - 1]?.km !== cum[last]) {
      samples.push({ km: cum[last], ele: candidate.coordinates[last][2] });
    }

    return { cum, totalKm, min, max, samples };
  }, [candidate]);

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Beim Kandidatenwechsel wird die Komponente über `key` neu montiert — der
  // Hover-Zustand gehört zur alten Route und verschwindet damit von selbst.

  const { paths } = useMemo(() => {
    if (width <= 0) return { paths: { area: "", line: "" } };
    const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const x = (km: number) => (km / model.totalKm) * width;
    const y = (ele: number) =>
      PAD_TOP + plotH - ((ele - model.min) / (model.max - model.min)) * plotH;

    let line = "";
    for (let i = 0; i < model.samples.length; i++) {
      const s = model.samples[i];
      line += `${i === 0 ? "M" : "L"}${x(s.km).toFixed(1)},${y(s.ele).toFixed(1)}`;
    }
    const area = `${line}L${width.toFixed(1)},${(HEIGHT - PAD_BOTTOM).toFixed(1)}L0,${(HEIGHT - PAD_BOTTOM).toFixed(1)}Z`;
    return { paths: { area, line } };
  }, [model, width]);

  const track = (clientX: number) => {
    const el = wrapper.current;
    if (!el || width <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const km = ratio * model.totalKm;
    const index = nearestIndex(model.cum, km);
    const point = candidate.coordinates[index];
    setHover({ x: ratio * width, km: model.cum[index], ele: point[2] });
    onHover(point);
  };

  const clear = () => {
    setHover(null);
    onHover(null);
  };

  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const hoverY =
    hover === null
      ? 0
      : PAD_TOP + plotH - ((hover.ele - model.min) / (model.max - model.min)) * plotH;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="t-label">Höhenprofil</span>
        <span className="text-[12px] tabular-nums text-ink-secondary">
          {hover
            ? `${hover.km.toFixed(1)} km · ${Math.round(hover.ele)} m`
            : `${Math.round(model.min)}–${Math.round(model.max)} m`}
        </span>
      </div>

      <div
        ref={wrapper}
        className="relative w-full touch-pan-y select-none"
        style={{ height: HEIGHT }}
        onPointerMove={(e) => track(e.clientX)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          track(e.clientX);
        }}
        onPointerUp={clear}
        onPointerLeave={clear}
        onPointerCancel={clear}
      >
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            className="overflow-visible"
            role="img"
            aria-label={`Höhenprofil: ${Math.round(candidate.ascent)} Höhenmeter auf ${(candidate.distance / 1000).toFixed(1)} Kilometern`}
          >
            <defs>
              <linearGradient id="elev-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--route)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--route)" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            <line
              x1="0"
              x2={width}
              y1={HEIGHT - PAD_BOTTOM}
              y2={HEIGHT - PAD_BOTTOM}
              stroke="var(--separator)"
              strokeWidth="1"
            />
            <path d={paths.area} fill="url(#elev-fill)" />
            <path
              d={paths.line}
              fill="none"
              stroke="var(--route)"
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {hover ? (
              <g>
                <line
                  x1={hover.x}
                  x2={hover.x}
                  y1={PAD_TOP - 4}
                  y2={HEIGHT - PAD_BOTTOM}
                  stroke="var(--ink-secondary)"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
                <circle cx={hover.x} cy={hoverY} r="4.5" fill="var(--route)" />
                <circle cx={hover.x} cy={hoverY} r="4.5" fill="none" stroke="var(--surface)" strokeWidth="2" />
              </g>
            ) : null}
          </svg>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between text-[11px] tabular-nums text-ink-secondary">
          <span>0 km</span>
          <span>{model.totalKm.toFixed(1)} km</span>
        </div>
      </div>
    </div>
  );
}
