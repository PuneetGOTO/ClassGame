import type { Action, Direction, Progress, Scene } from "../shared/protocol";
import type { Difficulty } from "../shared/route";

export interface Context { playerIds: string[]; seed: number; tier?: Difficulty }
export interface Frame { elapsed: number; activePlayers: string[] }

export interface GamePlugin<State> {
  init(context: Context): State;
  start?(state: State, context: Context): void;
  handleInput(state: State, playerId: string, input: Action, frame: Frame): boolean;
  tick?(state: State, frame: Frame): boolean;
  getState(state: State, viewer?: string): Scene;
  getProgress(state: State, viewer?: string): Progress;
  checkWin(state: State, playerId: string): boolean;
  isComplete?(state: State): boolean;
  finish?(state: State): void;
  destroy?(state: State): void;
}

export interface Engine {
  readonly timed: boolean;
  start(): void;
  handleInput(playerId: string, input: Action, frame: Frame): boolean;
  tick(frame: Frame): boolean;
  getState(viewer?: string): Scene;
  getProgress(viewer?: string): Progress;
  checkWin(playerId: string): boolean;
  isComplete(): boolean;
  finish(): void;
  destroy(): void;
  serialize(): string;
}

export type PluginFactory = (context: Context, saved?: string | null) => Engine;
export function plugin<State>(definition: GamePlugin<State>): PluginFactory {
  return (context, saved) => {
    const state: State = saved ? JSON.parse(saved) : definition.init(context);
    return {
      timed: !!definition.tick,
      start: () => definition.start?.(state, context),
      handleInput: (playerId, input, frame) => definition.handleInput(state, playerId, input, frame),
      tick: frame => definition.tick?.(state, frame) ?? false,
      getState: viewer => definition.getState(state, viewer),
      getProgress: viewer => definition.getProgress(state, viewer),
      checkWin: playerId => definition.checkWin(state, playerId),
      isComplete: () => definition.isComplete?.(state) ?? context.playerIds.every(id => definition.checkWin(state, id)),
      finish: () => definition.finish?.(state),
      destroy: () => definition.destroy?.(state),
      serialize: () => JSON.stringify(state)
    };
  };
}

export const movement: Record<Direction, readonly [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]
};
export function neighbor(index: number, direction: Direction, width: number, height: number) {
  const [dx, dy] = movement[direction];
  const x = index % width + dx;
  const y = Math.floor(index / width) + dy;
  return x >= 0 && x < width && y >= 0 && y < height ? y * width + x : -1;
}
export function rng(seed: number) {
  let value = seed >>> 0;
  return (max: number) => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return Math.floor(value / 4_294_967_296 * max);
  };
}
export function shuffled<T>(values: readonly T[], random: (max: number) => number) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index--) {
    const other = random(index + 1);
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}
export function gridFromRows(rows: string[]) {
  const width = rows[0].length;
  if (!rows.every(row => row.length === width)) throw new Error("Game grid rows must have equal width");
  return { width, height: rows.length, cells: rows.join("").split("") };
}

