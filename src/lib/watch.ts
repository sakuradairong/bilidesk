import type { NavigateFunction } from "react-router-dom";

export function openWatch(navigate: NavigateFunction, bvid: string, from: string) {
  navigate(`/watch/${bvid}`, { state: { from } });
}

export function watchBack(navigate: NavigateFunction, from?: string) {
  navigate(from || "/");
}
