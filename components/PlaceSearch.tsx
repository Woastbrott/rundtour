"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { GeocodeHit, LatLon } from "@/lib/ors/schema";

type Props = {
  onPick: (point: LatLon, label: string) => void;
  /** Suchergebnisse in der Nähe der aktuellen Kartenmitte bevorzugen. */
  focus?: LatLon | null;
};

/** Höhe der Liste, wenn sie voll aufgeklappt ist (max-h-64). */
const LIST_MAX_H = 256;

/**
 * Der Kasten, der die Liste abschneiden würde. Das ist der nächste
 * Scrollcontainer — und in jedem Fall der Bildschirm: das Sheet ragt im
 * eingeklappten Zustand unten aus dem Fenster heraus, sein Kasten allein sagt
 * also nichts darüber, wo noch etwas zu sehen ist.
 */
function clipBounds(node: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") {
      const rect = el.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
      break;
    }
  }
  return { top, bottom };
}

export function PlaceSearch({ onPick, focus }: Props) {
  const listId = useId();
  const [text, setText] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  /* Im Bottom-Sheet ist unter dem Feld oft kein Platz — dann klappt die Liste hoch. */
  const [dropUp, setDropUp] = useState(false);
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
      // Nur den einen Lauf schlucken, den das Übernehmen des Labels ausgelöst hat.
      // Sonst bliebe derselbe Ort für immer unsuchbar.
      if (query === chosen.current) {
        chosen.current = null;
        return;
      }
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

  /*
   * Vor dem Zeichnen entscheiden, in welche Richtung die Liste aufgeht: im Sheet
   * schneidet der Scrollcontainer sie sonst ab und die Treffer sind unsichtbar.
   */
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!open || hits.length === 0 || !box) return;
    const rect = box.getBoundingClientRect();
    const bounds = clipBounds(box);
    const needed = Math.min(hits.length * 40 + 8, LIST_MAX_H);
    const below = bounds.bottom - rect.bottom;
    const above = rect.top - bounds.top;
    setDropUp(below < needed && above > below);
  }, [open, hits]);

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
          className={`material animate-panel-in absolute left-0 z-30 max-h-64 w-full overflow-y-auto overscroll-contain rounded-[14px] p-1 ${
            dropUp ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
          }`}
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
                className={`w-full truncate rounded-[10px] px-2.5 py-2.5 text-left text-[14px] tracking-[-0.01em] transition-colors duration-150 md:py-2 ${
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
