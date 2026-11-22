/** BrowserQuest's licensed combat formula is isolated in upstream-combat.ts.
 *  The campus fort layout, quest, user interface and game entities are original.
 */
import { gridFromRows, rng, shuffled } from "../../packages/game-sdk";
import { tierValue } from "../../packages/shared/route";
import { quest } from "../quest";
import { damage } from "./upstream-combat";
const level = gridFromRows([
  "###########",
  "#....E....#",
  "#.##...##.#",
  "#..M...M..#",
  "#.........#",
  "#.##...##.#",
  "#....S....#",
  "###########"
]);
export default quest({
  theme: "fort",
  map(seed, tier) {
    const random = rng(seed);
    const spawn = level.cells.indexOf("S"), exit = level.cells.indexOf("E");
    const guards = [14, 18, 36, 40, 47, 51, 69, 73];
    return {
      width: level.width, height: level.height, spawn, exit,
      tiles: level.cells.map(tile => tile === "#" ? "wall" : "floor"),
      items: [], enemies: tier ? shuffled(guards, random).slice(0, tierValue(tier, [1, 2, 3, 4]))
        : level.cells.flatMap((tile,index) => tile === "M" ? [index] : [])
    };
  },
  damage: (_step,random) => damage(3,1,random)
});

