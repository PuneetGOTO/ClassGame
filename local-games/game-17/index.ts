/** Nearest-player dragon pursuit adapted from simon-borjeson/WebCraft, server/src/index.js (MIT).
 *  One shared two-dimensional expedition replaces the upstream open-world server.
 */
import { gridFromRows, neighbor, rng, shuffled } from "../../packages/game-sdk";
import { tierValue } from "../../packages/shared/route";
import { distance, quest } from "../quest";
const level = gridFromRows([
  "#############",
  "#.....E.....#",
  "#.##.....##.#",
  "#.C...D...C.#",
  "#....###....#",
  "#.C.......C.#",
  "#.##.....##.#",
  "#.....S.....#",
  "#############"
]);
export default quest({
  theme: "dragon",
  map(seed, tier) {
    const random = rng(seed);
    const crystals = level.cells.flatMap((tile,index) => tile === "C" ? [index] : []);
    const dragon = [level.cells.indexOf("D"), 43, 48, 70];
    return {
      width: level.width, height: level.height, spawn: level.cells.indexOf("S"), exit: level.cells.indexOf("E"),
      tiles: level.cells.map(tile => tile === "#" ? "wall" : random(5) === 0 ? "rock" : "floor"),
      items: tier ? shuffled([...crystals, 20, 66, 76, 96], random).slice(0, tierValue(tier, [1, 2, 3, 4])) : crystals,
      enemies: [tier ? dragon[random(dragon.length)] : dragon[0]]
    };
  },
  pursue(index,width,height,candidates,passable) {
    const nearest = candidates.slice().sort((a,b) => distance(index,a,width)-distance(index,b,width))[0];
    if (nearest === undefined || distance(index,nearest,width) > 5) return index;
    const options = (["up","down","left","right"] as const).map(direction => neighbor(index,direction,width,height))
      .filter(at => at >= 0 && passable(at));
    return options.find(at => distance(at,nearest,width) < distance(index,nearest,width)) ?? index;
  }
});

