import { describe, expect, it } from "vitest";

import { band, createSeatingSpring, projectVelocity } from "../seatingMotion";

function frames() {
  let now = 0;
  let id = 0;
  const queued = new Map<number, FrameRequestCallback>();
  return {
    request: (callback: FrameRequestCallback) => {
      id += 1;
      queued.set(id, callback);
      return id;
    },
    cancel: (handle: number) => queued.delete(handle),
    step: (milliseconds = 16) => {
      now += milliseconds;
      const current = [...queued.entries()];
      queued.clear();
      current.forEach(([, callback]) => callback(now));
    },
  };
}

describe("seating motion", () => {
  it("critically damped spring converges without overshooting", () => {
    const clock = frames();
    const values: number[] = [];
    createSeatingSpring({ from: 0, target: 1, response: 0.35, damping: 1, eps: 0.002, vEps: 0.02, onUpdate: (value) => values.push(value), requestFrame: clock.request, cancelFrame: clock.cancel });
    for (let index = 0; index < 63; index += 1) clock.step();
    expect(values.at(-1)).toBeCloseTo(1, 2);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
  });

  it("retargets a running spring without restarting from its origin", () => {
    const clock = frames();
    const values: number[] = [];
    const spring = createSeatingSpring({ from: 0, target: 1, response: 0.35, damping: 1, eps: 0.002, vEps: 0.02, onUpdate: (value) => values.push(value), requestFrame: clock.request, cancelFrame: clock.cancel });
    for (let index = 0; index < 8; index += 1) clock.step();
    const beforeRetarget = values.at(-1)!;
    spring.setTarget(2);
    clock.step();
    expect(values.at(-1)).toBeGreaterThan(beforeRetarget);
    expect(values.at(-1)).not.toBe(0);
  });

  it("stop prevents further updates", () => {
    const clock = frames();
    const values: number[] = [];
    const spring = createSeatingSpring({ from: 0, target: 1, response: 0.35, damping: 1, eps: 0.002, vEps: 0.02, onUpdate: (value) => values.push(value), requestFrame: clock.request, cancelFrame: clock.cancel });
    clock.step();
    spring.stop();
    const count = values.length;
    clock.step();
    expect(values).toHaveLength(count);
  });

  it("bands only beyond the allowed range", () => {
    expect(band(40, 100)).toBe(40);
    expect(band(200, 100)).toBeGreaterThan(100);
    expect(band(200, 100)).toBeLessThan(200);
  });

  it("projects velocity with the specified decay and sign", () => {
    expect(projectVelocity(1000)).toBeCloseTo(499, 6);
    expect(projectVelocity(-1000)).toBeCloseTo(-499, 6);
  });
});
