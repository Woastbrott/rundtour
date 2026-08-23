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
  children: React.ReactNode;
};

/** So viel vom Sheet bleibt im Peek-Zustand stehen. */
const PEEK_VISIBLE = 168;
/** Ab dieser Wischgeschwindigkeit entscheidet die Richtung, nicht die Position. */
const FLICK_VELOCITY = 320;

export function BottomSheet({ detent, onDetentChange, onVisibleHeight, children }: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  const spring = useRef<SpringHandle | null>(null);
  const tracker = useRef(new VelocityTracker());
  const dragging = useRef(false);
  const grabOffset = useRef(0);
  const [height, setHeight] = useState(0);

  // Die Zeigerhandler laufen außerhalb des Renders und brauchen den jeweils
  // aktuellen Stand — Zuweisung deshalb im Effekt, und zwar vor allen anderen.
  const detentRef = useRef(detent);
  const heightRef = useRef(0);
  useEffect(() => {
    detentRef.current = detent;
    heightRef.current = height;
  });

  const offsetFor = useCallback(
    (d: Detent, h: number = heightRef.current) => (d === "full" ? 0 : Math.max(h - PEEK_VISIBLE, 0)),
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
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      setHeight(next);
    });
    observer.observe(el);
    setHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  /* Detent von außen (oder nach dem Messen) anfahren. */
  useEffect(() => {
    if (height <= 0 || dragging.current) return;
    const target = offsetFor(detent, height);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
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
  }, [detent, height, offsetFor, paint, report]);

  useEffect(() => () => spring.current?.stop(), []);

  /* --- Geste ------------------------------------------------------- */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const current = spring.current?.value ?? offsetFor(detentRef.current);

    dragging.current = true;
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
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Grabber: die Geste lebt hier, damit die Slider im Inhalt nicht damit kämpfen. */}
      <div
        className="shrink-0 cursor-grab touch-none pt-2.5 pb-1 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <button
          type="button"
          aria-label={detent === "full" ? "Panel einklappen" : "Panel ausklappen"}
          aria-expanded={detent === "full"}
          onClick={() => onDetentChange(detent === "full" ? "peek" : "full")}
          className="mx-auto block h-6 w-full"
        >
          <span className="mx-auto block h-[5px] w-9 rounded-full bg-ink-secondary/40" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 pb-5">
        {children}
      </div>
    </div>
  );
}
