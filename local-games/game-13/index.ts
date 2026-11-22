/** Fraction generation adapted from hajunho/zeli-web-games FractionCompare (Apache-2.0).
 *  Exact cross products make equality a distinct answer.
 */
import { quiz } from "../math";
import { tierValue } from "../../packages/shared/route";
export default quiz({
  target: 7, count: 8, mustAnswerAll: true,
  course: tier => ({ target: tierValue(tier, [4, 5, 7, 9]), count: tierValue(tier, [5, 6, 8, 10]) }),
  generate(random, index, tier) {
    const span = tier ? tierValue(tier, [5, 9, 14, 20]) : 9;
    const b = 3 + random(span), a = 1 + random(b - 1);
    const equal = (index + random(4)) % 4 === 0;
    const d = equal ? b * 2 : 3 + random(span);
    const c = equal ? a * 2 : tier && tier >= 3
      ? Math.max(1, Math.min(d - 1, Math.round(a * d / b) + random(3) - 1))
      : 1 + random(d - 1);
    const comparison = a * d - c * b;
    return { text: a + "/" + b + "　?　" + c + "/" + d, solution: comparison > 0 ? "left" : comparison < 0 ? "right" : "equal",
      options: [{ label: "左邊較大", value: "left" }, { label: "一樣大", value: "equal" }, { label: "右邊較大", value: "right" }] };
  }
});

