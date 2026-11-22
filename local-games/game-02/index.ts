/** Reverse scrambling and cross toggles adapted from mashukui/web-games, lights-out (MIT). */
import { neighbor, plugin, rng, shuffled } from "../../packages/game-sdk";
import { tierValue } from "../../packages/shared/route";

function toggle(lights: boolean[], index: number) {
  const size = Math.sqrt(lights.length);
  const adjacent = (["up","down","left","right"] as const).map(direction => neighbor(index, direction, size, size));
  for (const position of [index, ...adjacent]) if (position >= 0) lights[position] = !lights[position];
}
const on = (lights: boolean[]) => lights.filter(Boolean).length;
export default plugin({
  init({ seed, tier }) {
    const size = tier ? tierValue(tier, [3, 4, 4, 5]) : 4;
    const lights = Array<boolean>(size ** 2).fill(false);
    const random = rng(seed);
    const buttons = shuffled(lights.map((_, index) => index), random);
    for (const index of buttons.slice(0, tier ? tierValue(tier, [3, 5, 8, 12]) : 6)) toggle(lights, index);
    if (on(lights) === 0) toggle(lights, random(lights.length));
    return lights;
  },
  handleInput(lights, _id, input) {
    if (input.kind !== "cell" || input.index >= lights.length) return false;
    toggle(lights, input.index);
    return true;
  },
  getState: lights => ({
    kind: "grid", width: Math.sqrt(lights.length), height: Math.sqrt(lights.length),
    tiles: lights.map((active, index) => ({ kind: active ? "lamp-on" : "lamp-off", label: active ? "✦" : "·",
      title: "燈 " + (index + 1) + (active ? " 亮" : " 暗"), action: true }))
  }),
  getProgress: lights => ({ value: lights.length - on(lights), target: lights.length, label: "已熄滅" }),
  checkWin: lights => on(lights) === 0
});

