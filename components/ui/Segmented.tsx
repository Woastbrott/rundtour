"use client";

import { useId } from "react";

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
};

/**
 * iOS-Segmented-Control: der Hintergrund gleitet zur Auswahl, statt zu springen.
 * Nicht gestengesteuert, deshalb reicht hier eine CSS-Transition — keine Feder nötig.
 */
export function Segmented<T extends string>({ options, value, onChange, label }: Props<T>) {
  const id = useId();
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="relative isolate flex rounded-[10px] bg-sunken p-[2px]"
    >
      <span
        aria-hidden
        className="absolute inset-y-[2px] left-[2px] -z-10 rounded-[8px] bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-transform duration-300 ease-ios"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            id={`${id}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            /*
             * min-w-0 + truncate: "Nur Radnetz" ist bei drei Segmenten auf einem
             * 360-px-Display breiter als sein Drittel und schob den Regler sonst
             * über den Rand.
             */
            className={`min-w-0 flex-1 truncate rounded-[8px] px-2 py-[9px] text-[13px] font-medium tracking-[-0.01em] transition-colors duration-200 md:px-3 md:py-[7px] ${
              active ? "text-ink" : "text-ink-secondary hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
