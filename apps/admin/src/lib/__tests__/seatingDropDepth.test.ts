import { describe, expect, it } from "vitest";

import { enter, leave, reset } from "../seatingDropDepth";

describe("seating drop depth", () => {
  it("stays over until every nested drag leave has occurred", () => {
    const entered = enter(enter(0).depth);

    expect(leave(entered.depth)).toEqual({ depth: 1, isOver: true });
  });

  it("clears when the final drag leave occurs", () => {
    expect(leave(enter(0).depth)).toEqual({ depth: 0, isOver: false });
  });

  it("never returns a negative depth", () => {
    expect(leave(0)).toEqual({ depth: 0, isOver: false });
  });

  it("resets the drag state", () => {
    expect(reset()).toEqual({ depth: 0, isOver: false });
  });
});
