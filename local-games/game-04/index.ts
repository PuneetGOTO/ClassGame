/** Vehicle occupancy and legal movement adapted from mashukui/web-games, rush-hour (MIT).
 *  Campus puzzle layout and exit lane are original.
 */
import { plugin, movement, rng, type Context } from "../../packages/game-sdk";
import { tierValue } from "../../packages/shared/route";

interface Car { x: number; y: number; length: number; horizontal: boolean }
const size = 6;
const cars: Car[] = [
  { x: 0, y: 2, length: 2, horizontal: true },
  { x: 2, y: 1, length: 3, horizontal: false },
  { x: 4, y: 1, length: 2, horizontal: false },
  { x: 3, y: 3, length: 2, horizontal: true },
  { x: 1, y: 4, length: 2, horizontal: true },
  { x: 0, y: 3, length: 3, horizontal: false },
  { x: 3, y: 0, length: 2, horizontal: false },
  { x: 4, y: 5, length: 2, horizontal: true }
];
const occupies = (car: Car, x: number, y: number) => car.horizontal
  ? car.y === y && x >= car.x && x < car.x + car.length
  : car.x === x && y >= car.y && y < car.y + car.length;
const carAt = (list: Car[], x: number, y: number) => list.findIndex(car => occupies(car,x,y));

function canMove(list: Car[], index: number, dx: number, dy: number) {
  const car = list[index];
  if ((car.horizontal && dy) || (!car.horizontal && dx)) return false;
  const x = car.x + (dx > 0 ? car.length : dx);
  const y = car.y + (dy > 0 ? car.length : dy);
  return x >= 0 && x < size && y >= 0 && y < size && carAt(list, x, y) < 0;
}
function initial({ seed, tier }: Context) {
  const list = cars.slice(0, tier ? tierValue(tier, [3, 5, 7, 8]) : cars.length).map(car => ({ ...car }));
  if (tier) {
    const random = rng(seed);
    if (random(2)) {
      for (const car of list) car.y = size - car.y - (car.horizontal ? 1 : car.length);
    }
    // A reversible walk preserves the solvability of each starting layout.
    for (let i = 0; i < tierValue(tier, [2, 4, 6, 8]); i++) {
      const moves = list.flatMap((_, index) => index === 0 ? [] : Object.values(movement).flatMap(([dx,dy]) =>
        canMove(list, index, dx, dy) ? [{ index,dx,dy }] : []));
      if (!moves.length) break;
      const { index,dx,dy } = moves[random(moves.length)];
      list[index].x += dx;
      list[index].y += dy;
    }
  }
  return { cars: list, selected: 0, escaped: false };
}
export default plugin({
  init: initial,
  handleInput(state, _player, input) {
    if (input.kind === "cell") {
      const index = carAt(state.cars, input.index % (size + 1), Math.floor(input.index / (size + 1)));
      if (index < 0) return false;
      state.selected = index;
      return true;
    }
    if (input.kind !== "move") return false;
    const car = state.cars[state.selected];
    const [dx,dy] = movement[input.direction];
    if ((car.horizontal && dy) || (!car.horizontal && dx)) return false;
    if (state.selected === 0 && dx > 0 && car.x + car.length === size) {
      car.x++;
      state.escaped = true;
      return true;
    }
    if (!canMove(state.cars, state.selected, dx, dy)) return false;
    car.x += dx; car.y += dy;
    return true;
  },
  getState(state) {
    const width = size + 1;
    return { kind: "grid", width, height: size, tiles: Array.from({ length: width * size }, (_, i) => {
      const x = i % width, y = Math.floor(i / width);
      const index = carAt(state.cars,x,y);
      if (index < 0) return { kind: x !== size ? "floor" : y === state.cars[0].y ? "exit" : "wall" };
      const direction = state.cars[index].horizontal ? "↔" : "↕";
      const kind = index === state.selected ? (index === 0 ? "car-goal tile-car-selected" : "car tile-car-selected") : index === 0 ? "car-goal" : "car";
      return { kind, tint: index, action: true, label: direction, title: index === 0 ? "金色目標車" : "車輛 " + (index + 1) };
    }) };
  },
  getProgress: state => ({
    value: state.escaped ? size - 1 : state.cars[0].x, target: size - 1, label: "目標車前進格數"
  }),
  checkWin: state => state.escaped
});

