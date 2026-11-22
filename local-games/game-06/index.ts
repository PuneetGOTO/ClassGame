/** Tile collision and BFS navigation adapted from mashukui/web-games, maze-muncher (MIT).
 *  Campus maze, collectibles, ghost behavior and renderer are original.
 */
import { gridFromRows, neighbor, plugin, rng, shuffled, type Context } from "../../packages/game-sdk";
import type { Direction } from "../../packages/shared/protocol";
import { tierValue } from "../../packages/shared/route";
const map = gridFromRows([
  "###########",
  "#P...#....#",
  "#.##...##.#",
  "#....#....#",
  "###.###.#.#",
  "#.....#...#",
  "#.#.#...#G#",
  "#...###...#",
  "###########"
]);
const directions: Direction[] = ["up","left","down","right"];
const next = (board: typeof map, index: number, direction: Direction) => neighbor(index, direction, board.width, board.height);
function chase(board: typeof map, from: number, target: number) {
  const queue = [{ index: from, first: from }];
  const seen = new Set([from]);
  for (const { index, first } of queue) {
    if (index === target) return first;
    for (const direction of directions) {
      const tile = next(board,index,direction);
      if (tile < 0 || board.cells[tile] === "#" || seen.has(tile)) continue;
      seen.add(tile);
      queue.push({ index: tile, first: index === from ? tile : first });
    }
  }
  return from;
}
function initial({ seed, tier }: Context) {
  const random = rng(seed);
  const transform = tier ? random(4) : 0;
  const { width, height } = map;
  const cells = map.cells.map((_, index) => {
    const x = index % width, y = Math.floor(index / width);
    return map.cells[((transform & 2) ? height - 1 - y : y) * width + ((transform & 1) ? width - 1 - x : x)];
  });
  const board = { width, height, cells };
  const start = cells.indexOf("P"), ghostStart = cells.indexOf("G");
  const target = tier ? tierValue(tier, [6, 9, 13, 17]) : 12;
  const dots = cells.map(tile => tile === ".");
  if (tier) {
    const nearby = new Set([start]);
    for (const at of nearby) {
      for (const dir of directions) {
        const cell = next(board, at, dir);
        if (cell >= 0 && cells[cell] !== "#") nearby.add(cell);
      }
    }
    const candidates = shuffled([...nearby].filter(at => dots[at]), random);
    const selected = new Set(candidates.slice(0, target + 8));
    dots.forEach((_, index) => { dots[index] = selected.has(index); });
  }
  return { board, start, ghostStart, player: start, ghost: ghostStart, eaten: 0, nextGhost: 3500, misses: 0, immune: 0,
    target, speed: tier ? tierValue(tier, [950, 780, 650, 500]) : 650, dots };
}
function collision(state: ReturnType<typeof initial>, elapsed: number) {
  if (state.player !== state.ghost || elapsed < state.immune) return;
  state.misses++;
  state.player = state.start;
  state.ghost = state.ghostStart;
  state.immune = elapsed + 1800;
}
export default plugin({
  init: initial,
  handleInput(state, _id, input, frame) {
    if (input.kind !== "move") return false;
    const tile = next(state.board, state.player, input.direction);
    if (tile < 0 || state.board.cells[tile] === "#") return false;
    state.player = tile;
    if (state.dots[tile]) { state.dots[tile] = false; state.eaten++; }
    collision(state, frame.elapsed);
    return true;
  },
  tick(state, frame) {
    if (frame.elapsed < state.nextGhost) return false;
    state.ghost = chase(state.board,state.ghost,state.player);
    state.nextGhost = frame.elapsed + state.speed;
    collision(state, frame.elapsed);
    return true;
  },
  getState: state => ({ kind: "grid", width: state.board.width, height: state.board.height,
    tiles: state.board.cells.map((tile, index) => ({ kind: index === state.player ? "player" : index === state.ghost ? "enemy"
      : tile === "#" ? "wall" : state.dots[index] ? "dot" : "floor" })) }),
  getProgress: state => ({ label: "已收集豆子", target: state.target, value: state.eaten }),
  checkWin: state => state.eaten >= state.target
});

