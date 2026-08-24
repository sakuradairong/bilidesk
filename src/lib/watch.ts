import { createPath, type NavigateFunction } from "react-router-dom";

export function routeSource(location: {
  pathname: string;
  search?: string;
  hash?: string;
}): string {
  return createPath(location);
}

export type ReturnNavigationState = {
  from?: string;
  fromState?: unknown;
};

export function openWatch(
  navigate: NavigateFunction,
  bvid: string,
  from: string,
  fromState?: unknown,
) {
  const state: ReturnNavigationState = { from };
  if (fromState !== undefined) state.fromState = fromState;
  navigate(`/watch/${bvid}`, { state });
}

export function watchBack(
  navigate: NavigateFunction,
  from?: string,
  fromState?: unknown,
) {
  if (!from) {
    navigate("/");
    return;
  }
  if (fromState === undefined) navigate(from);
  else navigate(from, { state: fromState });
}
