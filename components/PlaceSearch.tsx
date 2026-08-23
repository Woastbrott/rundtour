"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { GeocodeHit, LatLon } from "@/lib/ors/schema";

type Props = {
  onPick: (point: LatLon, label: string) => void;
  /** Suchergebnisse in der Nähe der aktuellen Kartenmitte bevorzugen. */
  focus?: LatLon | null;
};

export function PlaceSearch({ onPick, focus }: Props) {
  const listId = useId();
  const [text, setText] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /*
   * Beim Auswählen wandert das Label ins Eingabefeld. Ohne diese Sperre würde das
   * sofort die nächste Suche auslösen und das Dropdown direkt wieder aufklappen.
   */
  const chosen = useRef<string | null>(null);

  useEffect(() => {
    const query = text.trim();
    const controller = new AbortController();

    // Getippt wird schnell, das Geocoding-Kontingent ist klein — 280 ms Ruhe vor jedem Call.
    const timer = window.setTimeout(async () => {
      if (query === chosen.current) return;
      if (query.length < 2) {
        setHits([]);
        setError(null);
        return;
      }
      try {
        const params = new URLSearchParams({ text: query });
        if (focus) {
          params.set("lat", String(focus.lat));
          params.set("lon", String(focus.lon));
        }
        const response = await fetch(`/api/geocode?${params.toString()}`, {
          signal: controller.signal,
        });
        const data: unknown = await response.json();
        if (!response.ok) {
          const message =
            typeof data === "object" && data && "error" in data && typeof data.error === "string"
              ? data.error
              : "Die Ortssuche ist gerade nicht erreichbar.";
          setError(message);
          setHits([]);
          return;
        }
        const list =
          typeof data === "object" && data && "hits" in data && Array.isArray(data.hits)
            ? (data.hits as GeocodeHit[])
            : [];
        setError(null);
        setHits(list);
        setOpen(true);
        setActive(-1);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError("Die Ortssuche ist gerade nicht erreichbar.");
        setHits([]);
      }
    }, 280);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [text, focus]);

  useEffect(() => {
    const onDocumentDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocumentDown);
    return () => document.removeEventListener("pointerdown", onDocumentDown);
  }, []);

  const choose = (hit: GeocodeHit) => {
    chosen.current = hit.label.trim();
    onPick({ lat: hit.lat, lon: hit.lon }, hit.label);
    setText(hit.label);
    setHits([]);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(hits[active >= 0 ? active : 0]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Ort suchen"
        aria-label="Ort suchen"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className="w-full rounded-[10px] bg-sunken px-3 py-2 text-[15px] tracking-[-0.01em] text-ink placeholder:text-ink-secondary focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />

      {error ? <p className="mt-1.5 text-[12px] text-route">{error}</p> : null}

      {open && hits.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="material animate-panel-in absolute top-[calc(100%+6px)] left-0 z-30 max-h-64 w-full overflow-y-auto rounded-[14px] p-1"
        >
          {hits.map((hit, i) => (
            <li key={`${hit.label}-${hit.lat}-${hit.lon}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(hit);
                }}
                onMouseEnter={() => setActive(i)}
                className={`w-full truncate rounded-[10px] px-2.5 py-2 text-left text-[14px] tracking-[-0.01em] transition-colors duration-150 ${
                  i === active ? "bg-accent text-accent-ink" : "text-ink"
                }`}
              >
                {hit.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
