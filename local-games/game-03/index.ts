/** Tree generation and reciprocal-arm BFS adapted from mashukui/web-games, pipe-connect (MIT). */
import { neighbor, plugin, rng, shuffled } from "../../packages/game-sdk";
import { tierValue, type Difficulty } from "../../packages/shared/route";

const directions = ["up", "right", "down", "left"] as const;
const adjacent = (index: number, direction: number, size: number) => neighbor(index, directions[direction], size, size);
const arm = (mask: number, direction: number) => (mask & (1 << direction)) !== 0;
const rotate = (mask: number) => ((mask << 1) | (mask >> 3)) & 15;
function flowing(masks: number[]) {
  const size = Math.sqrt(masks.length);
  const wet = new Set([0]);
  const queue = [0];
  for (const current of queue) {
    directions.forEach((_, direction) => {
      if (!arm(masks[current], direction)) return;
      const next = adjacent(current, direction, size);
      if (next < 0 || wet.has(next) || !arm(masks[next], (direction + 2) % 4)) return;
      wet.add(next);
      queue.push(next);
    });
  }
  return wet;
}
function create(seed: number, tier?: Difficulty) {
  const random = rng(seed);
  const size = tier && tier >= 3 ? 4 : 3;
  const count = size ** 2;
  const masks = Array<number>(count).fill(0);
  const visited = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const current = stack.at(-1)!;
    const options = directions.map((_, direction) => ({ direction, next: adjacent(current, direction, size) }))
      .filter(({ next }) => next >= 0 && !visited.has(next));
    if (!options.length) { stack.pop(); continue; }
    const { direction, next } = options[random(options.length)];
    masks[current] |= 1 << direction;
    masks[next] |= 1 << ((direction + 2) % 4);
    stack.push(next);
    visited.add(next);
  }
  masks[0] |= 1 << 3;
  masks[count - 1] |= 1 << 1;
  const scramble = new Set(shuffled(masks.map((_, i) => i).slice(1, -1), random)
    .slice(0, tier ? tierValue(tier, [4, 7, 10, 14]) : count));
  const mixed = masks.map((mask, index) => {
    if (!scramble.has(index)) return mask;
    for (let turns = 1 + random(3); turns > 0; turns--) mask = rotate(mask);
    return mask;
  });
  if (flowing(mixed).size === count) {
    const first = mixed.findIndex((mask, index) => index > 0 && index < count - 1 && mask !== rotate(mask));
    if (first >= 0) mixed[first] = rotate(mixed[first]);
  }
  return { masks: mixed };
}
export default plugin({
  init: ({ seed, tier }) => create(seed, tier),
  handleInput(state, _player, input) {
    if (input.kind !== "cell" || input.index < 1 || input.index >= state.masks.length - 1) return false;
    state.masks[input.index] = rotate(state.masks[input.index]);
    return true;
  },
  getState(state) {
    const wet = flowing(state.masks);
    const count = state.masks.length;
    const size = Math.sqrt(count);
    return {
      kind: "grid", width: size, height: size,
      tiles: state.masks.map((mask, index) => ({ mask, kind: wet.has(index) ? "pipe-wet" : "pipe",
        action: index > 0 && index < count - 1, label: index === 0 ? "入" : index === count - 1 ? "出" : undefined,
        title: index === 0 ? "入口" : index === count - 1 ? "出口" : "旋轉水管 " + (index + 1) }))
    };
  },
  getProgress: state => ({ value: flowing(state.masks).size, target: state.masks.length, label: "已接通管段" }),
  checkWin: state => flowing(state.masks).size === state.masks.length
});

