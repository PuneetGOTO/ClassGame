/** Hidden-range target adapted from assishmoncs/battlebox, games/numberhunt.js (MIT).
 *  Closest-guess turns become independent arithmetic deduction clues with server-only solutions.
 */
import { options, quiz, shuffle } from "../math";
import { tierValue } from "../../packages/shared/route";
export default quiz({
  target: 4, count: 14,
  course: tier => ({ target: tierValue(tier, [3, 4, 6, 8]) }),
  generate(random, index, tier) {
    const target = 10 + random(tier ? tierValue(tier, [14, 24, 40, 70]) : 21);
    const factor = 2 + random(tier ? tierValue(tier, [2, 4, 5, 8]) : 4);
    const delta = 3 + random(7);
    const offset = 10 + random(7);
    const clues = [
      "我的 " + factor + " 倍減去 " + delta + " 得 " + (target * factor - delta) + "。",
      "我的兩倍再加 " + delta + " 等於 " + (2 * target + delta) + "。",
      tier && tier >= 3
        ? "我加上 " + offset + " 再乘 " + factor + " 後得到 " + ((target + offset) * factor) + "。"
        : "我減去 " + offset + " 後得到 " + (target - offset) + "。",
      tier === 4
        ? "我減去 " + delta + " 再乘 " + factor + " 等於 " + ((target - delta) * factor) + "。"
        : "我和 " + delta + " 的乘積是 " + (target * delta) + "。"
    ];
    const nearby = shuffle([-5,-3,-2,-1,1,2,3,5],random).slice(0,3).map(step => target + step);
    return { text: clues[index % clues.length], solution: String(target), options: options(shuffle([target,...nearby],random)) };
  }
});

