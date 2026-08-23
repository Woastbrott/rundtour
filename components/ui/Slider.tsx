"use client";

import { useId } from "react";

type Props = {
  label: string;
  /** Formatierter Ist-Wert rechts neben dem Label. */
  display: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  /** Optionale Beschriftungen unter der Spur, z. B. für die Höhenstufen. */
  ticks?: readonly string[];
};

export function Slider({ label, display, min, max, step, value, onChange, ticks }: Props) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="t-label">
          {label}
        </label>
        <span className="text-[15px] font-semibold tabular-nums tracking-[-0.01em]">{display}</span>
      </div>

      <input
        id={id}
        type="range"
        className="slider mt-1.5"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
      />

      {ticks ? (
        <div className="mt-0.5 flex justify-between px-[3px]">
          {ticks.map((tick, i) => (
            <span
              key={tick}
              className={`text-[11px] tracking-[0.01em] transition-colors duration-200 ${
                i === value ? "font-semibold text-ink" : "text-ink-secondary"
              }`}
            >
              {tick}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
