/**
 * Feder-Physik für gestengetriebene Bewegung.
 *
 * Warum keine CSS-Transition: eine Transition lässt sich nicht mitten im Flug
 * greifen und umdrehen. Eine Feder startet immer beim aktuellen Ist-Wert und
 * übernimmt die Geschwindigkeit — genau das braucht das Bottom-Sheet.
 *
 * Parametrisiert wie bei Apple, nicht wie im Physikbuch:
 *   damping  1.0 = kein Überschwingen, < 1.0 = federt nach
 *   response      Zeit in Sekunden bis der Wert am Ziel ist (keine feste Dauer)
 */

export type SpringConfig = { damping: number; response: number };

/** Ruhige UI-Bewegung ohne Nachfedern. */
export const SPRING_SETTLE: SpringConfig = { damping: 1.0, response: 0.4 };
/** Nach einem Wisch — der Schwung darf man sehen. */
export const SPRING_FLICK: SpringConfig = { damping: 0.82, response: 0.3 };

/**
 * Wo eine Bewegung mit dieser Geschwindigkeit zur Ruhe käme.
 * Exponentieller Zerfall wie beim Scroll-Momentum, nicht v²/2a.
 */
export function project(velocityPxPerS: number, decelerationRate = 0.998): number {
  return ((velocityPxPerS / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Weicher Widerstand jenseits der Grenze statt hartem Anschlag. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export type SpringHandle = {
  /** Neues Ziel, ohne Sprung: Position und Geschwindigkeit laufen weiter. */
  retarget: (to: number, config?: SpringConfig) => void;
  /** Wert hart setzen (z. B. während einer Geste, die 1:1 folgt). */
  set: (value: number, velocity?: number) => void;
  stop: () => void;
  readonly value: number;
  readonly velocity: number;
};

type SpringArgs = {
  from: number;
  to: number;
  velocity?: number;
  config?: SpringConfig;
  onFrame: (value: number) => void;
  onRest?: () => void;
};

const SUBSTEP = 1 / 240;

export function createSpring({
  from,
  to,
  velocity = 0,
  config = SPRING_SETTLE,
  onFrame,
  onRest,
}: SpringArgs): SpringHandle {
  let x = from;
  let v = velocity;
  let target = to;
  let cfg = config;
  let frame = 0;
  let last = 0;

  const step = (now: number) => {
    const dt = last === 0 ? SUBSTEP : Math.min((now - last) / 1000, 0.064);
    last = now;

    const omega = (2 * Math.PI) / cfg.response;
    let remaining = dt;
    while (remaining > 0) {
      const h = Math.min(SUBSTEP, remaining);
      const a = -(omega * omega) * (x - target) - 2 * cfg.damping * omega * v;
      v += a * h;
      x += v * h;
      remaining -= h;
    }

    onFrame(x);

    if (Math.abs(x - target) < 0.35 && Math.abs(v) < 0.6) {
      x = target;
      v = 0;
      frame = 0;
      onFrame(x);
      onRest?.();
      return;
    }
    frame = requestAnimationFrame(step);
  };

  frame = requestAnimationFrame(step);

  return {
    retarget(next, nextConfig) {
      target = next;
      if (nextConfig) cfg = nextConfig;
      if (frame === 0) {
        last = 0;
        frame = requestAnimationFrame(step);
      }
    },
    set(value, nextVelocity = 0) {
      x = value;
      v = nextVelocity;
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      onFrame(x);
    },
    stop() {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    },
    get value() {
      return x;
    },
    get velocity() {
      return v;
    },
  };
}

/** Geschwindigkeit aus den letzten Zeigerpositionen, nicht aus zwei Frames. */
export class VelocityTracker {
  private samples: Array<{ t: number; v: number }> = [];

  add(value: number, time = performance.now()): void {
    this.samples.push({ t: time, v: value });
    while (this.samples.length > 6) this.samples.shift();
  }

  clear(): void {
    this.samples = [];
  }

  /** px pro Sekunde, über ein ~100-ms-Fenster gemittelt. */
  get velocity(): number {
    if (this.samples.length < 2) return 0;
    const last = this.samples[this.samples.length - 1];
    let first = this.samples[0];
    for (const s of this.samples) {
      if (last.t - s.t <= 110) {
        first = s;
        break;
      }
    }
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0.001) return 0;
    return (last.v - first.v) / dt;
  }
}
