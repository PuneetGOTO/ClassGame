/** Movement adapted from mashukui/web-games, sokoban/index.html (MIT). */
import { gridFromRows, neighbor, plugin, rng, shuffled, type Context } from "../../packages/game-sdk";
import { tierValue } from "../../packages/shared/route";

const original = gridFromRows([
  "#######", "#  .  #", "#     #", "#  B  #", "# B B #", "# . . #", "#  @  #", "#######"
]);
const layout = gridFromRows([
  "########", "#      #", "#      #", "#      #", "#      #", "#      #", "#      #", "########"
]);
const directions = ["up", "left", "down", "right"] as const;
type Board = ReturnType<typeof gridFromRows>;

function scramble(seed: number, tier: NonNullable<Context["tier"]>) {
  const random = rng(seed);
  const interior = layout.cells.flatMap((cell, index) => {
    const x = index % layout.width, y = Math.floor(index / layout.width);
    return cell !== "#" && x >= 2 && x <= 5 && y >= 2 && y <= 5 ? [index] : [];
  });
  const goals = shuffled(interior, random).slice(0, tier + 1);
  const boxes = goals.slice();
  const next = (index: number, d: number) => neighbor(index, directions[d], layout.width, layout.height);
  const floor = (index: number) => index >= 0 && layout.cells[index] !== "#" && !boxes.includes(index);
  const visited = new Set([boxes.toSorted().join(",")]);
  let player = layout.width + 1;

  // Each step undoes a legal push. Reversing the pulls gives a solution.
  for (let count = 0; count < tierValue(tier, [5, 9, 14, 20]); count++) {
    const reachable = new Set([player]);
    for (const position of reachable) {
      directions.forEach((_, d) => {
        const at = next(position, d);
        if (floor(at)) reachable.add(at);
      });
    }
    const choices: { index: number; position: number; back: number; key: string; displaced: number }[] = [];
    for (const position of reachable) {
      directions.forEach((_, d) => {
        const index = boxes.indexOf(next(position, d));
        const back = next(position, (d + 2) % 4);
        if (index < 0 || !floor(back)) return;
        const moved = boxes.with(index, position);
        const key = moved.toSorted().join(",");
        if (!visited.has(key)) choices.push({ index, position, back, key, displaced: moved.filter(at => !goals.includes(at)).length });
      });
    }
    if (!choices.length) break;
    const mostDisplaced = Math.max(...choices.map(item => item.displaced));
    const options = choices.filter(item => item.displaced === mostDisplaced);
    const choice = options[random(options.length)];
    player = choice.back;
    boxes[choice.index] = choice.position;
    visited.add(choice.key);
  }
  return { board: layout, startPlayer: player, startBoxes: boxes, goals };
}
type Setup = { board: Board; startPlayer: number; startBoxes: number[]; goals: number[] };
function initial({ seed, tier }: Context) {
  const setup: Setup = tier ? scramble(seed, tier) : {
    board: original, startPlayer: original.cells.indexOf("@"),
    startBoxes: original.cells.flatMap((tile, index) => tile === "B" ? [index] : []),
    goals: original.cells.flatMap((tile, index) => tile === "." ? [index] : [])
  };
  return { ...setup, player: setup.startPlayer, boxes: setup.startBoxes.slice() };
}
const placed = (state: ReturnType<typeof initial>) => state.boxes.filter(index => state.goals.includes(index)).length;

export default plugin({
  init: initial,
  handleInput(state, _player, input) {
    if (input.kind === "action" && input.action === "interact") {
      const changed = state.player !== state.startPlayer || state.boxes.some((at, index) => at !== state.startBoxes[index]);
      state.player = state.startPlayer;
      state.boxes = state.startBoxes.slice();
      return changed;
    }
    if (input.kind !== "move") return false;
    const { width, height, cells } = state.board;
    const isWall = (index: number) => index < 0 || cells[index] === "#";
    const next = neighbor(state.player, input.direction, width, height);
    if (isWall(next)) return false;
    const box = state.boxes.indexOf(next);
    if (box !== -1) {
      const destination = neighbor(next, input.direction, width, height);
      if (isWall(destination) || state.boxes.includes(destination)) return false;
      state.boxes[box] = destination;
    }
    state.player = next;
    return true;
  },
  getState(state) {
    const { width, height, cells } = state.board;
    return {
      kind: "grid", width, height,
      tiles: cells.map((cell, index) => ({
        label: index === state.player ? "●" : undefined,
        kind: index === state.player ? (state.goals.includes(index) ? "player tile-goal" : "player") : state.boxes.includes(index) ? (state.goals.includes(index) ? "box-done" : "box")
          : cell === "#" ? "wall" : state.goals.includes(index) ? "goal" : "floor"
      }))
    };
  },
  getProgress: state => ({ value: placed(state), target: state.boxes.length, label: "箱子歸位" }),
  checkWin: state => placed(state) === state.boxes.length
});

