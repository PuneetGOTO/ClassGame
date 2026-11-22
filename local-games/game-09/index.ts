/** Time-spaced obstacles and forgiving hit boxes adapted from mashukui/web-games, dino-run (MIT). */
import { plugin, rng, type Context } from "../../packages/game-sdk";
import type { ArcadeActor } from "../../packages/shared/protocol";
import { tierValue } from "../../packages/shared/route";
import { overlaps, advance } from "../motion";

const jumpMs = 1120;
const duckMs = 1120;
const initial = ({ seed, tier }: Context) => {
  const random = rng(seed);
  const gaps = Array.from({ length: 32 }, () => (tier ? 2360 - tier * 130 : 2100) + random(550));
  const birds = gaps.map((_, index) => tier ? index > 0 && random(10) < tier+1 : index % 4 === 2);
  return { elapsed: 0, jumpAt: -jumpMs, duckUntil: -1, nextAt: tier ? 700 + random(650) : 1000, streak: 0, faults: 0, spawned: 0, gaps, birds,
    target: tier ? tierValue(tier, [4, 6, 8, 10]) : 8, speed: tier ? 1.24 + tier * .09 : 1.38,
    obstacles: [] as (ArcadeActor & { passed: boolean })[] };
};
type State = ReturnType<typeof initial>;
function dino(state: State): ArcadeActor {
  const position = (state.elapsed - state.jumpAt) / jumpMs;
  const jump = position >= 0 && position <= 1 ? 37 * 4 * position * (1 - position) : 0;
  const duck = jump === 0 && state.elapsed < state.duckUntil;
  const height = duck ? 11 : 24;
  return { kind: "dino", x: 16, y: 84 - jump - height, width: duck ? 13 : 10, height };
}
function simulate(state: State) {
  if (state.elapsed >= state.nextAt) {
    const bird = state.birds[state.spawned % state.birds.length];
    state.obstacles.push({ kind: bird ? "bird" : "cactus", x: 100, y: bird ? 53 : 67, width: bird ? 9 : 6,
      height: 17, passed: false });
    state.nextAt += state.gaps[state.spawned % state.gaps.length];
    state.spawned++;
  }
  const runner = dino(state);
  for (const obstacle of state.obstacles) {
    obstacle.x -= state.speed;
    if (obstacle.passed) continue;
    if (overlaps(runner,obstacle,2)) {
      obstacle.passed = true;
      state.streak = 0;
      state.faults++;
    } else if (obstacle.x + obstacle.width < runner.x) {
      obstacle.passed = true;
      state.streak++;
    }
  }
  state.obstacles = state.obstacles.filter(obstacle => obstacle.x > -12);
}
export default plugin({
  init: initial,
  handleInput(state, _id, input, frame) {
    if (input.kind !== "action") return false;
    if (input.action === "jump" && frame.elapsed - state.jumpAt >= jumpMs) {
      state.jumpAt = frame.elapsed;
      state.duckUntil = -1;
      return true;
    }
    if (input.action === "duck" && frame.elapsed - state.jumpAt >= jumpMs) {
      state.duckUntil = frame.elapsed + duckMs;
      return true;
    }
    return false;
  },
  tick: (state, frame) => advance(state, frame.elapsed, simulate),
  getState: state => ({ kind: "arcade", theme: "desert", actors: [...state.obstacles, dino(state)] }),
  getProgress: state => ({ label: "連續閃避障礙", target: state.target, value: state.streak }),
  checkWin: state => state.streak >= state.target
});

