/** Looping lane offsets and wrapped car collision adapted from mashukui/web-games, cross-road (MIT). */
import { movement, plugin, rng, type Context } from "../../packages/game-sdk";
import type { ArcadeActor } from "../../packages/shared/protocol";
import { overlaps, wrap } from "../motion";

const originalRows = ["safe","road","road","safe","road","road","road","safe"];
const columns = 8;
const colWidth = 100 / columns;
type Lane = { row: number; offset: number; speed: number; width: number };
const initial = ({ seed, tier }: Context) => {
  const random = rng(seed);
  const rows = tier ? ["safe","road","road","safe", ...Array<string>(tier).fill("road"), "safe"] : originalRows;
  const start = { row: rows.length - 1, col: tier ? 2 + random(4) : Math.floor(columns / 2) };
  const lanes: Lane[] = rows.flatMap((kind, row) => kind === "road" ?
    [{ row, offset: random(100), speed: (row % 2 ? 1 : -1) * (10 + (tier ?? 1) * 2 + random(10)), width: 11 + (tier ?? 1) + random(6) }] : []);
  return { ...start, start, rows, lanes, elapsed: 0, furthest: 0, hits: 0, won: false };
};
type State = ReturnType<typeof initial>;
const rowHeight = (state: State) => 100 / state.rows.length;
const avatar = (state: State): ArcadeActor => ({
  kind: "runner", x: state.col * colWidth + 2, y: state.row * rowHeight(state) + 2, width: colWidth - 4, height: rowHeight(state) - 4
});
function cars(lanes: Lane[], elapsed: number, height: number): ArcadeActor[] {
  return lanes.flatMap(({ row, offset, speed, width }) =>
    [0, 50].flatMap(spacing => {
      const x = wrap(offset + speed * elapsed / 1000 + spacing, 100);
      const actor = { kind: "car", x, y: row * height + 2, width, height: height - 4, tint: row };
      return x + width > 100 ? [actor, { ...actor, x: x - 100 }] : [actor];
    }));
}
function collide(state: State) {
  if (state.rows[state.row] !== "road") return;
  const player = avatar(state);
  if (!cars(state.lanes.filter(lane => lane.row === state.row), state.elapsed, rowHeight(state)).some(car => overlaps(player, car, 1))) return;
  Object.assign(state, state.start);
  state.hits++;
}
export default plugin({
  init: initial,
  handleInput(state, _id, input) {
    if (input.kind !== "move") return false;
    const [dx,dy] = movement[input.direction];
    const row = state.row + dy, col = state.col + dx;
    if (row < 0 || row >= state.rows.length || col < 0 || col >= columns) return false;
    Object.assign(state, { row, col });
    collide(state);
    state.furthest = Math.max(state.furthest, state.start.row - state.row);
    state.won = state.row === 0;
    return true;
  },
  tick(state, frame) {
    if (frame.elapsed - state.elapsed < 40) return false;
    state.elapsed = frame.elapsed;
    collide(state);
    return true;
  },
  getState: state => ({ kind: "arcade", theme: "road", rows: state.rows, actors: [...cars(state.lanes, state.elapsed, rowHeight(state)), avatar(state)] }),
  getProgress: state => ({ label: "已前進路段", target: state.start.row, value: state.furthest }),
  checkWin: state => state.won
});

