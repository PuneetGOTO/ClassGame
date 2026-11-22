/** Seeded DFS adapted from tristanbudd/minigames, server/maze.js (MIT).
 *  The personal route varies maze dimensions and the number of signals to collect.
 */
import { neighbor, plugin, rng } from "../../packages/game-sdk";
import type { Direction } from "../../packages/shared/protocol";
import { tierValue } from "../../packages/shared/route";
import { shuffle } from "../math";

const directions: Direction[] = ["up", "right", "down", "left"];
function carve(size: number, start: number, random: ReturnType<typeof rng>) {
  const next = (index: number, direction: Direction) => neighbor(index, direction, size, size);
  const wall = Array<boolean>(size ** 2).fill(true);
  const stack = [start];
  wall[start] = false;
  while (stack.length) {
    const index = stack.at(-1)!;
    const choice = shuffle(directions, random).map(direction => {
      const between = next(index, direction);
      return { between, end: between < 0 ? -1 : next(between, direction) };
    }).find(({ end }) => end >= 0 && wall[end]);
    if (!choice) { stack.pop(); continue; }
    wall[choice.between] = wall[choice.end] = false;
    stack.push(choice.end);
  }
  const extra = wall.flatMap((tile, index) =>
    tile && index > size && index < size * (size - 1) && index % size > 0 && index % size < size - 1 &&
      ((!wall[index - 1] && !wall[index + 1]) || (!wall[index - size] && !wall[index + size])) ? [index] : []
  );
  for (const index of shuffle(extra, random).slice(0, 5)) wall[index] = false;
  return wall;
}

export default plugin({
  init({ seed, playerIds, tier }) {
    const random = rng(seed);
    const size = tier ? tierValue(tier, [5, 7, 9, 11]) : 9;
    const start = size + 1;
    const goal = (size - 2) * size + size - 2;
    const wall = carve(size, start, random);
    const items = shuffle(wall.flatMap((solid, index) => !solid && index !== start && index !== goal ? [index] : []), random);
    const players = Object.fromEntries(playerIds.map((id, i) => {
      const signals = tier ? items.slice(0, tierValue(tier, [1, 2, 3, 4])) : [items[i]];
      return [id, { position: start, signals, collected: 0, done: false, tint: i }];
    }));
    return { wall, players, size, goal };
  },
  handleInput(state, id, input) {
    const player = state.players[id];
    if (input.kind !== "move" || !player || player.done) return false;
    const tile = neighbor(player.position, input.direction, state.size, state.size);
    if (tile < 0 || state.wall[tile]) return false;
    player.position = tile;
    const signal = player.signals.indexOf(tile);
    if (signal >= 0) {
      player.signals.splice(signal, 1);
      player.collected++;
    }
    if (tile === state.goal && player.signals.length === 0) player.done = true;
    return true;
  },
  getState(state, viewer) {
    return { kind: "grid", width: state.size, height: state.size, tiles: state.wall.map((wall, index) => {
      const all = Object.entries(state.players);
      const atTile = all.filter(([,player]) => player.position === index);
      const occupant = atTile.find(([id]) => id === viewer)?.[1] ?? atTile[0]?.[1];
      if (occupant) return { kind: occupant.done ? "player-done" : "player", tint: occupant.tint, label: atTile.length > 1 ? String(atTile.length) : String(occupant.tint + 1) };
      const item = all.find(([,player]) => player.signals.includes(index))?.[1];
      if (item) return { kind: "crystal", tint: item.tint, label: String(item.tint + 1) };
      return { kind: wall ? "wall" : index === state.goal ? "exit" : "floor" };
    }) };
  },
  getProgress(state, viewer) {
    const player = viewer ? state.players[viewer] : undefined;
    const all = Object.values(state.players);
    return player ? { value: player.collected + Number(player.done),
      target: player.signals.length + player.collected + 1, label: "訊號與出口" }
      : { value: all.filter(player => player.done).length, target: all.length, label: "抵達出口的隊員" };
  },
  checkWin: state => Object.values(state.players).every(player => player.done)
});

