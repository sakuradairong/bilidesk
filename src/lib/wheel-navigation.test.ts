import { describe, expect, it } from "vitest";

import {
  advanceWheelNavigation,
  createWheelNavigationState,
  normalizeWheelDelta,
  shouldIgnoreWheelNavigation,
  type WheelNavigationState,
} from "./wheel-navigation";

const PAGE_HEIGHT = 800;

function advance(
  state: WheelNavigationState,
  overrides: Partial<Parameters<typeof advanceWheelNavigation>[1]> = {},
) {
  return advanceWheelNavigation(state, {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    now: 0,
    pageHeight: PAGE_HEIGHT,
    ...overrides,
  });
}

describe("normalizeWheelDelta", () => {
  it("normalizes pixel, line and page deltas", () => {
    expect(normalizeWheelDelta(2, 0, PAGE_HEIGHT)).toBe(2);
    expect(normalizeWheelDelta(2, 1, PAGE_HEIGHT)).toBe(32);
    expect(normalizeWheelDelta(2, 2, PAGE_HEIGHT)).toBe(1600);
  });
});

describe("advanceWheelNavigation", () => {
  it("ignores horizontal and zoom gestures", () => {
    const state = createWheelNavigationState();
    expect(
      advance(state, { deltaX: 80, deltaY: 40, now: 10 }).consumed,
    ).toBe(false);
    expect(
      advance(state, { deltaY: 100, ctrlKey: true, now: 10 }).consumed,
    ).toBe(false);
  });

  it("accumulates small trackpad deltas before navigating", () => {
    let state = createWheelNavigationState();
    let result = advance(state, { deltaY: 24, now: 10 });
    expect(result.direction).toBeNull();
    state = result.state;

    result = advance(state, { deltaY: 24, now: 30 });
    expect(result.direction).toBeNull();
    state = result.state;

    result = advance(state, { deltaY: 30, now: 50 });
    expect(result.direction).toBe(1);
    expect(result.consumed).toBe(true);
  });

  it("maps upward and downward gestures to the expected direction", () => {
    expect(
      advance(createWheelNavigationState(), { deltaY: -120, now: 10 })
        .direction,
    ).toBe(-1);
    expect(
      advance(createWheelNavigationState(), { deltaY: 120, now: 10 })
        .direction,
    ).toBe(1);
  });

  it("resets accumulated distance when the direction reverses", () => {
    const first = advance(createWheelNavigationState(), {
      deltaY: 60,
      now: 10,
    });
    const reversed = advance(first.state, { deltaY: -30, now: 20 });

    expect(reversed.direction).toBeNull();
    expect(reversed.state.accumulated).toBe(-30);
    expect(reversed.state.direction).toBe(-1);
  });

  it("locks a continuous gesture so inertial deltas cannot skip items", () => {
    const triggered = advance(createWheelNavigationState(), {
      deltaY: 100,
      now: 10,
    });
    expect(triggered.direction).toBe(1);

    const inertia = advance(triggered.state, { deltaY: 100, now: 150 });
    expect(inertia.direction).toBeNull();
    expect(inertia.state.locked).toBe(true);

    const moreInertia = advance(inertia.state, { deltaY: 100, now: 260 });
    expect(moreInertia.direction).toBeNull();
  });

  it("keeps mixed-axis samples inside the active gesture lock", () => {
    const triggered = advance(createWheelNavigationState(), {
      deltaY: 100,
      now: 10,
    });
    const horizontal = advance(triggered.state, {
      deltaX: 100,
      deltaY: 20,
      now: 170,
    });
    const moreHorizontal = advance(horizontal.state, {
      deltaX: 100,
      deltaY: 20,
      now: 320,
    });
    const verticalAgain = advance(moreHorizontal.state, {
      deltaY: 100,
      now: 430,
    });

    expect(verticalAgain.direction).toBeNull();
    expect(verticalAgain.state.locked).toBe(true);
  });

  it("starts a new gesture after the quiet period and cooldown", () => {
    const triggered = advance(createWheelNavigationState(), {
      deltaY: 100,
      now: 10,
    });
    const nextGesture = advance(triggered.state, {
      deltaY: -100,
      now: 400,
    });

    expect(nextGesture.direction).toBe(-1);
    expect(nextGesture.consumed).toBe(true);
  });

  it("normalizes line deltas before applying the threshold", () => {
    const result = advance(createWheelNavigationState(), {
      deltaY: 5,
      deltaMode: 1,
      now: 10,
    });

    expect(result.direction).toBe(1);
  });
});

describe("shouldIgnoreWheelNavigation", () => {
  it("keeps ordinary stage content navigable", () => {
    const target = {
      isContentEditable: false,
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldIgnoreWheelNavigation(target)).toBe(false);
  });

  it("ignores editable and nested interactive targets", () => {
    const editable = {
      isContentEditable: true,
      closest: () => null,
    } as unknown as HTMLElement;
    const nestedSvg = {
      isContentEditable: false,
      closest: () => ({ tagName: "BUTTON" }),
    } as unknown as HTMLElement;

    expect(shouldIgnoreWheelNavigation(editable)).toBe(true);
    expect(shouldIgnoreWheelNavigation(nestedSvg)).toBe(true);
  });
});
