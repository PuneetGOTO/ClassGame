/** Smoothed tile height map adapted from goddtriffin/Oasis, server/engine/utils.js and world.js (BSD-3-Clause). */
import { rng } from "../../packages/game-sdk";
import { quest } from "../quest";
import { shuffle } from "../math";

const width = 11, height = 8;
const spawn = 4 * width + 5;
function map(seed: number) {
  const random = rng(seed);
  const heights = Array.from({ length: width * height }, () => random(1000));
  const smoothed = heights.map((_, i) => {
    const x = i % width, y = Math.floor(i / width);
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      sum += heights[((y+dy+height)%height)*width + (x+dx+width)%width];
    }
    return sum / 9;
  });
  const items = shuffle([14,18,25,30,57,62,69,74],random);
  return { width, height, spawn, exit: spawn, items, enemies: [],
    tiles: smoothed.map((level, index) => index < width || index >= width * (height-1) || index % width === 0 || index % width === width-1
      ? "wall" : level < 405 ? "water" : level < 480 ? "sand" : level > 605 ? "rock" : "grass") };
}
export default quest({ theme: "oasis", map });

