/** Wave formation and projectile collision adapted from mashukui/web-games, star-defender (MIT). */
import { plugin, rng, type Context } from "../../packages/game-sdk";
import type { ArcadeActor } from "../../packages/shared/protocol";
import { tierValue } from "../../packages/shared/route";
import { overlaps, advance } from "../motion";

interface Invader { lane: number; row: number; live: boolean }
function wave(): Invader[] {
  return Array.from({ length: 12 }, (_, i) => ({ lane: i % 6, row: Math.floor(i / 6), live: true }));
}
const initial = ({ seed, tier }: Context) => {
  const random = rng(seed);
  return { x: tier ? 20 + random(56) : 47, lastShot: -1000, elapsed: 0, waveAt: 0, kills: 0, enemies: wave(),
    target: tier ? tierValue(tier, [4, 6, 8, 11]) : 8, drift: tier ? 6 + tier : 4,
    phase: tier ? random(1000) / 100 : 0, speed: tier ? 1.5 + tier * 0.62 : 2.8, beams: [] as ArcadeActor[] };
};
type State = ReturnType<typeof initial>;
const enemies = (state: State) => state.enemies.flatMap((enemy, index) => {
  if (!enemy.live) return [];
  const time = (state.elapsed - state.waveAt) / 1000;
  return [{ index, kind: "invader", width: 8, height: 8,
    x: 10 + 14 * enemy.lane + state.drift * Math.sin(time * 1.3 + state.phase), y: 8 + enemy.row * 14 + state.speed * time }];
});
function simulate(state: State) {
  for (const beam of state.beams) beam.y -= 4;
  const targets = enemies(state).sort((a,b) => b.y - a.y);
  state.beams = state.beams.filter(beam => {
    if (beam.y < -beam.height) return false;
    const target = targets.find(item => state.enemies[item.index].live && overlaps(beam,item));
    if (!target) return true;
    state.enemies[target.index].live = false;
    state.kills = Math.min(state.target, state.kills + 1);
    return false;
  });
  if (state.kills === state.target) return true;
  if (targets.some(enemy => enemy.y > 84) || state.enemies.every(enemy => !enemy.live)) {
    state.enemies = wave();
    state.waveAt = state.elapsed;
  }
  return false;
}
export default plugin({
  init: initial,
  handleInput(state, _id, input, frame) {
    if (input.kind === "move" && (input.direction === "left" || input.direction === "right")) {
      state.x = Math.max(1, Math.min(92, state.x + (input.direction === "left" ? -4.5 : 4.5)));
      return true;
    }
    if (input.kind !== "action" || input.action !== "shoot" || frame.elapsed - state.lastShot < 220) return false;
    state.lastShot = frame.elapsed;
    state.beams.push({ kind: "beam", x: state.x + 3, y: 80, width: 1.7, height: 5 });
    return true;
  },
  tick: (state, frame) => state.kills < state.target && advance(state, frame.elapsed, simulate),
  getState: state => ({ kind: "arcade", theme: "space", actors: [...enemies(state), ...state.beams,
    { kind: "pilot", x: state.x, y: 86, width: 8, height: 10 }] }),
  getProgress: state => ({ label: "擊落飛船", target: state.target, value: state.kills }),
  checkWin: state => state.kills >= state.target
});

