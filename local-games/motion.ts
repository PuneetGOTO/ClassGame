import type { ArcadeActor } from "../packages/shared/protocol";

/** Axis-aligned hit boxes with forgiveness at the moving object's edges. */
export function overlaps(a: ArcadeActor, b: ArcadeActor, pad = 0) {
  return a.x + pad < b.x + b.width && a.x + a.width - pad > b.x &&
    a.y + pad < b.y + b.height && a.y + a.height - pad > b.y;
}
export function advance<T extends { elapsed: number }>(state: T, elapsed: number, simulate: (state: T) => boolean) {
  const quantum = 40;
  if (elapsed - state.elapsed < quantum) return false;
  while (elapsed - state.elapsed >= quantum) {
    state.elapsed += quantum;
    if (simulate(state)) break;
  }
  return true;
}
export const wrap = (x: number, length: number) => ((x % length) + length) % length;

