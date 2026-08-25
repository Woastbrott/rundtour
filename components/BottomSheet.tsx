"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  createSpring,
  project,
  rubberband,
  SPRING_FLICK,
  SPRING_SETTLE,
  VelocityTracker,
  type SpringHandle,
} from "@/lib/spring";

export type Detent = "peek" | "full";

type Props = {
  detent: Detent;
  onDetentChange: (detent: Detent) => void;
  /** Sichtbare Höhe in Pixeln, gemeldet wenn die Bewegung zur Ruhe kommt. */
  onVisibleHeight?: (px: number) => void;
  /** So viel Inhalt bleibt im Peek-Zustand stehen (ohne Safe-Area). */
  peekVisible?: number;
  children: React.ReactNode;
};

/** So viel vom Sheet bleibt im Peek-Zustand stehen, wenn nichts anderes gesagt wird. */
const PEEK_VISIBLE = 168;
/** Ab dieser Wischgeschwindigkeit entscheidet die Richtung, nicht die Position. */
const FLICK_VELOCITY = 320;
/** Bis hierhin gilt eine Zeigerbewegung noch als Tippen, nicht als Ziehen.
 *  Großzügig gewählt: ein Daumen wackelt, ein echtes Ziehen ist deutlich mehr. */
const TAP_SLOP = 8;

export function BottomSheet({
  detent,
  onDetentChange,
  onVisibleHeight,
  peekVisible = PEEK_VISIBLE,
  children,
}: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  const spring = useRef<SpringHandle | null>(null);
  const tracker = useRef(new VelocityTracker());
  const dragging = useRef(false);
  const grabOffset = useRef(0);
  /*
   * Nach dem Ziehen feuert der Browser zusätzlich ein click auf den Griff. Ohne
   * diese Markierung würde der Klick-Handler den gerade erreichten Rastpunkt
   * sofort wieder umschalten — das Sheet schnappt zurück.
   */
  const moved = useRef(false);
  const startY = useRef(0);
  /* Home-Indicator-Polsterung; zählt zur Sheet-Höhe, aber nicht zum Inhalt. */
  const safeBottom = useRef(0);
  const [height, setHeight] = useState(0);

  // Die Zeigerhandler laufen außerhalb des Renders und brauchen den jeweils
  // aktuellen Stand — Zuweisung deshalb im Effekt, und zwar vor allen anderen.
  const detentRef = useRef(detent);
  const heightRef = useRef(0);
  useEffect(() => {
    detentRef.current = detent;
    heightRef.current = height;
  });

  const peekRef = useRef(peekVisible);
  useEffect(() => {
    peekRef.current = peekVisible;
  });

  const offsetFor = useCallback(
    (d: Detent, h: number = heightRef.current) =>
      d === "full" ? 0 : Math.max(h - (peekRef.current + safeBottom.current), 0),
    [],
  );

  const paint = useCallback((y: number) => {
    const el = sheet.current;
    if (!el) return;
    el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    el.style.opacity = "1";
  }, []);

  /*
   * Startposition unterhalb des Bildschirms setzen, bevor der Browser zeichnet.
   * Die Position gehört ab hier allein der Feder — deshalb liegt hier auch keine
   * CSS-Animation auf `transform`: zwei Systeme auf derselben Eigenschaft heißt,
   * dass die Animation die Geste überstimmt und das Ziehen wirkungslos wird.
   */
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    el.style.transform = "translate3d(0, 110%, 0)";
    el.style.opacity = "0";
  }, []);

  const report = useCallback(() => {
    onVisibleHeight?.(Math.max(heightRef.current - offsetFor(detentRef.current), 0));
  }, [offsetFor, onVisibleHeight]);

  /* Höhe messen — das Sheet ist so hoch wie sein Inhalt, gedeckelt auf 82 % der Höhe. */
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const measure = (px: number) => {
      safeBottom.current = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      setHeight(px);
    };
    const observer = new ResizeObserver(([entry]) => {
      measure(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(el);
    measure(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  /* Detent von außen (oder nach dem Messen) anfahren. */
  useEffect(() => {
    if (height <= 0 || dragging.current) return;
    const target = offsetFor(detent, height);
    /*
     * In einem Hintergrund-Tab läuft kein requestAnimationFrame. Ohne diese
     * Abkürzung bliebe das Sheet auf opacity 0 stehen — auf dem Handy ist das
     * die komplette Bedienung, die Seite wäre nur Karte.
     */
    const snap =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden;

    if (snap) {
      spring.current?.stop();
      paint(target);
      report();
      return;
    }

    if (spring.current) {
      spring.current.retarget(target, SPRING_SETTLE);
    } else {
      // Erster Auftritt: von unterhalb des Bildschirms hochfedern — dieselbe
      // Physik wie später bei der Geste, nicht eine zweite Bewegungssprache.
      spring.current = createSpring({
        from: height,
        to: target,
        config: SPRING_SETTLE,
        onFrame: paint,
        onRest: report,
      });
    }
    report();
  }, [detent, height, peekVisible, offsetFor, paint, report]);

  useEffect(() => () => spring.current?.stop(), []);

  /*
   * Wer im eingeklappten Sheet in ein Feld tippt, will damit arbeiten — und die
   * Bildschirmtastatur nimmt gleich die Hälfte des Platzes. Also aufklappen,
   * sonst steht die Vorschlagsliste halb außerhalb des Bildschirms.
   */
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const onFocusIn = (e: FocusEvent) => {
      if (detentRef.current !== "peek") return;
      const target = e.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) onDetentChange("full");
    };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  }, [onDetentChange]);

  /* --- Geste ------------------------------------------------------- */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const current = spring.current?.value ?? offsetFor(detentRef.current);

    dragging.current = true;
    moved.current = false;
    startY.current = e.clientY;
    // Vom Ist-Wert aus greifen, nicht vom Zielwert — sonst springt es beim Zupacken.
    grabOffset.current = e.clientY - current;
    tracker.current.clear();
    tracker.current.add(e.clientY);
    spring.current?.stop();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    tracker.current.add(e.clientY);

    if (Math.abs(e.clientY - startY.current) > TAP_SLOP) moved.current = true;

    const raw = e.clientY - grabOffset.current;
    const max = offsetFor("peek");
    let y = raw;
    // Über die Grenzen hinaus zunehmender Widerstand statt hartem Anschlag.
    if (raw < 0) y = -rubberband(-raw, heightRef.current);
    else if (raw > max) y = max + rubberband(raw - max, heightRef.current);

    spring.current?.set(y);
    if (!spring.current) paint(y);
  };

  const finish = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const velocity = tracker.current.velocity;
    const current = spring.current?.value ?? 0;
    const max = offsetFor("peek");

    // Nicht zum nächsten Rastpunkt ab Loslasspunkt, sondern ab dem projizierten Endpunkt.
    const projected = current + project(velocity);
    const next: Detent =
      Math.abs(velocity) > FLICK_VELOCITY
        ? velocity > 0
          ? "peek"
          : "full"
        : Math.abs(projected - 0) <= Math.abs(projected - max)
          ? "full"
          : "peek";

    const target = offsetFor(next);
    const config = Math.abs(velocity) > FLICK_VELOCITY ? SPRING_FLICK : SPRING_SETTLE;

    // Reduzierte Bewegung: Ziehen bleibt 1:1 (das ist direkte Manipulation, keine
    // Animation), aber beim Loslassen wird gesetzt statt gefedert.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      spring.current?.stop();
      paint(target);
      if (next !== detentRef.current) onDetentChange(next);
      else report();
      return;
    }

    if (spring.current) {
      // Geschwindigkeit übernehmen, damit zwischen Ziehen und Animieren keine Naht entsteht.
      spring.current.set(current, velocity);
      spring.current.retarget(target, config);
    } else {
      spring.current = createSpring({
        from: current,
        to: target,
        velocity,
        config,
        onFrame: paint,
        onRest: report,
      });
    }

    if (next !== detentRef.current) onDetentChange(next);
    else report();
  };

  return (
    <div
      ref={sheet}
      className="material fixed inset-x-0 bottom-0 z-20 flex max-h-[82svh] flex-col rounded-t-[20px] rounded-b-none border-b-0 will-change-transform"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        // Querformat auf Geräten mit Notch: sonst liegt der Inhalt darunter.
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Grabber: die Geste lebt hier, damit die Slider im Inhalt nicht damit kämpfen. */}
      <div
        className="shrink-0 cursor-grab touch-none pt-2 pb-1 select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <button
          type="button"
          aria-label={detent === "full" ? "Panel einklappen" : "Panel ausklappen"}
          aria-expanded={detent === "full"}
          onClick={() => {
            // Nach einer Ziehbewegung hat `finish` den Rastpunkt schon gesetzt.
            if (moved.current) {
              moved.current = false;
              return;
            }
            onDetentChange(detent === "full" ? "peek" : "full");
          }}
          className="mx-auto grid h-9 w-full place-items-center"
        >
          <span className="block h-[5px] w-9 rounded-full bg-ink-secondary/40" />
        </button>
      </div>

      {/* overflow-x-clip: die Aktionsleiste zieht ihren Hintergrund über die
          Polsterung hinaus; ohne das ließe sich das Sheet 20 px seitlich schieben. */}
      <div className="min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain px-5 pt-1 pb-5">
        {children}
      </div>
    </div>
  );
}
