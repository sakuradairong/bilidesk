export type WheelNavigationDirection = -1 | 1;

export interface WheelNavigationState {
  accumulated: number;
  direction: WheelNavigationDirection | null;
  lastEventAt: number;
  locked: boolean;
  lockedUntil: number;
}

export interface WheelNavigationInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  now: number;
  pageHeight: number;
  ctrlKey?: boolean;
}

export interface WheelNavigationOptions {
  threshold: number;
  lineHeight: number;
  idleMs: number;
  cooldownMs: number;
  maxDelta: number;
}

export interface WheelNavigationResult {
  state: WheelNavigationState;
  direction: WheelNavigationDirection | null;
  consumed: boolean;
}

export const DEFAULT_WHEEL_NAVIGATION_OPTIONS: WheelNavigationOptions = {
  threshold: 76,
  lineHeight: 16,
  idleMs: 180,
  cooldownMs: 200,
  maxDelta: 120,
};

const WHEEL_NAVIGATION_IGNORE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  '[role="dialog"]',
  '[role="slider"]',
  '[contenteditable]:not([contenteditable="false"])',
  '[data-wheel-navigation="ignore"]',
].join(",");

export function createWheelNavigationState(): WheelNavigationState {
  return {
    accumulated: 0,
    direction: null,
    lastEventAt: Number.NEGATIVE_INFINITY,
    locked: false,
    lockedUntil: Number.NEGATIVE_INFINITY,
  };
}

export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  pageHeight: number,
  lineHeight = DEFAULT_WHEEL_NAVIGATION_OPTIONS.lineHeight,
): number {
  if (deltaMode === 1) return delta * lineHeight;
  if (deltaMode === 2) return delta * pageHeight;
  return delta;
}

export function advanceWheelNavigation(
  current: WheelNavigationState,
  input: WheelNavigationInput,
  options: WheelNavigationOptions = DEFAULT_WHEEL_NAVIGATION_OPTIONS,
): WheelNavigationResult {
  if (input.ctrlKey) return maintainGestureLock(current, input.now);

  const deltaX = normalizeWheelDelta(
    input.deltaX,
    input.deltaMode,
    input.pageHeight,
    options.lineHeight,
  );
  const deltaY = normalizeWheelDelta(
    input.deltaY,
    input.deltaMode,
    input.pageHeight,
    options.lineHeight,
  );
  if (Math.abs(deltaY) <= Math.abs(deltaX) || deltaY === 0) {
    return maintainGestureLock(current, input.now);
  }

  const idle = input.now - current.lastEventAt >= options.idleMs;
  if (current.locked) {
    if (!idle) {
      return idleResult({ ...current, lastEventAt: input.now });
    }
    if (input.now < current.lockedUntil) return idleResult(current);
  }

  const base = idle
    ? createWheelNavigationState()
    : current;
  const direction: WheelNavigationDirection = deltaY > 0 ? 1 : -1;
  const accumulated =
    base.direction != null && base.direction !== direction
      ? clampDelta(deltaY, options.maxDelta)
      : base.accumulated + clampDelta(deltaY, options.maxDelta);

  if (Math.abs(accumulated) < options.threshold) {
    return idleResult({
      ...base,
      accumulated,
      direction,
      lastEventAt: input.now,
    });
  }

  return {
    state: {
      accumulated: 0,
      direction,
      lastEventAt: input.now,
      locked: true,
      lockedUntil: input.now + options.cooldownMs,
    },
    direction,
    consumed: true,
  };
}

export function shouldIgnoreWheelNavigation(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (typeof element.closest !== "function") return false;
  return element.closest(WHEEL_NAVIGATION_IGNORE_SELECTOR) != null;
}

function clampDelta(delta: number, maxDelta: number): number {
  return Math.min(maxDelta, Math.max(-maxDelta, delta));
}

function maintainGestureLock(
  state: WheelNavigationState,
  now: number,
): WheelNavigationResult {
  return idleResult(state.locked ? { ...state, lastEventAt: now } : state);
}

function idleResult(state: WheelNavigationState): WheelNavigationResult {
  return { state, direction: null, consumed: false };
}
