/** Contiguous color pouring adapted from mashukui/web-games, water-sort (MIT). */
import { plugin, rng } from "../../packages/game-sdk";
import { shuffle } from "../math";
import { tierValue } from "../../packages/shared/route";
const capacity = 4;
const fullColor = (tube: number[]) => tube.length === capacity && tube.every(value => value === tube[0]);
export default plugin({
  init({ seed, tier }) {
    const random = rng(seed);
    if (tier) {
      const target = tierValue(tier, [2, 3, 4, 5]);
      const colors = shuffle([0, 1, 2, 3, 4], random).slice(0, target);
      const mixed = colors.map((color, index) => {
        const next = colors[(index + 1) % target];
        if (tier === 4) return [color, color, next, colors[(index + 2) % target]];
        return tier === 3 ? [color, color, next, next] : [color, color, color, next];
      });
      return { tubes: shuffle([...mixed, [], []], random), selected: -1, target };
    }
    const [a,b,c] = shuffle([0,1,2], random);
    return { tubes: shuffle([[a,a,b,c],[b,b,c,a],[c,c,a,b],[],[]], random), selected: -1, target: 3 };
  },
  handleInput(state, _id, input) {
    if (input.kind !== "cell" || input.index >= state.tubes.length) return false;
    const destination = state.tubes[input.index];
    if (state.selected === input.index) { state.selected = -1; return true; }
    if (state.selected < 0) {
      if (!destination.length) return false;
      state.selected = input.index;
      return true;
    }
    const source = state.tubes[state.selected];
    const color = source.at(-1);
    if (destination.length === capacity || (destination.length && destination.at(-1) !== color) || (!destination.length && fullColor(source))) {
      state.selected = destination.length ? input.index : -1;
      return true;
    }
    while (source.length && source.at(-1) === color && destination.length < capacity) destination.push(source.pop()!);
    state.selected = -1;
    return true;
  },
  getState: state => ({ kind: "tubes", tubes: state.tubes, selected: state.selected, capacity }),
  getProgress: state => ({ label: "已完成試管", target: state.target, value: state.tubes.filter(fullColor).length }),
  checkWin: state => state.tubes.every(tube => !tube.length || fullColor(tube))
});

