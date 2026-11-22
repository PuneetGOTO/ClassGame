/** Question bank adapted from assishmoncs/battlebox, games/mathduel.js (MIT).
 *  Replaces alternating turns and upstream scoring with one synchronized question every six seconds.
 */
import { arithmetic, quiz } from "../math";
import { tierValue } from "../../packages/shared/route";

const questions = [
  ["7 + 6", 13], ["9 + 8", 17], ["12 − 5", 7], ["15 − 9", 6], ["6 × 4", 24], ["7 × 3", 21],
  ["20 ÷ 5", 4], ["18 ÷ 3", 6], ["11 + 14", 25], ["30 − 13", 17], ["8 × 5", 40], ["27 ÷ 9", 3]
] as const;
export default quiz({
  target: 7, count: 10, synchronized: true,
  course: tier => ({
    target: tierValue(tier, [3, 5, 7, 9]),
    count: 15,
    synchronized: false,
    generate: (random, index, level) => {
      const { text, solution } = arithmetic(random, index, level);
      return { text, solution };
    }
  }),
  generate(random, index) {
    const [text, answer] = questions[(index * 5 + random(questions.length)) % questions.length];
    return { text, solution: String(answer) };
  }
});

