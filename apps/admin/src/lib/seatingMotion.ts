export type SeatingSpringOptions = {
  from: number;
  target: number;
  response: number;
  damping: number;
  velocity?: number;
  eps: number;
  vEps: number;
  onUpdate: (value: number) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
};

export type SeatingSpring = {
  setTarget: (target: number) => void;
  stop: () => void;
  getTarget: () => number;
  isRunning: () => boolean;
};

/** A small critically damped spring with a mutable target. */
export function createSeatingSpring(options: SeatingSpringOptions): SeatingSpring {
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
  let value = options.from;
  let target = options.target;
  let velocity = options.velocity ?? 0;
  let frame: number | null = null;
  let previousTime: number | null = null;
  let stopped = false;

  const tick = (time: number) => {
    if (stopped) return;
    const dt = previousTime === null ? 0.016 : Math.max(0.001, Math.min(0.032, (time - previousTime) / 1000));
    previousTime = time;
    const w = (2 * Math.PI) / options.response;
    const k = w * w;
    const c = 2 * w * options.damping;
    velocity += (k * (target - value) - c * velocity) * dt;
    value += velocity * dt;

    if (Math.abs(target - value) <= options.eps && Math.abs(velocity) <= options.vEps) {
      value = target;
      velocity = 0;
      frame = null;
      options.onUpdate(value);
      return;
    }

    options.onUpdate(value);
    frame = requestFrame(tick);
  };

  const start = () => {
    if (frame !== null || stopped) return;
    previousTime = null;
    frame = requestFrame(tick);
  };

  start();
  return {
    setTarget(nextTarget) {
      target = nextTarget;
      start();
    },
    stop() {
      stopped = true;
      if (frame !== null) cancelFrame(frame);
      frame = null;
    },
    getTarget: () => target,
    isRunning: () => frame !== null,
  };
}

export function band(value: number, max: number, c = 0.55): number {
  if (Math.abs(value) <= max) return value;
  const over = Math.abs(value) - max;
  return Math.sign(value) * (max + (over * max * c) / (max + c * over));
}

export function projectVelocity(velocity: number, decay = 0.998): number {
  return (velocity / 1000) * decay / (1 - decay);
}
