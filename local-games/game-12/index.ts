/** Trial division adapted from hajunho/zeli-web-games PrimeCheck (Apache-2.0). */
import { quiz } from "../math";
import { tierValue } from "../../packages/shared/route";

export function isPrime(value: number) {
  if (value < 2) return false;
  for (let divisor = 2; divisor * divisor <= value; divisor++) if (value % divisor === 0) return false;
  return true;
}
export default quiz({
  target: 8, count: 10, mustAnswerAll: true,
  course: tier => ({ target: tierValue(tier, [4, 6, 8, 10]), count: tierValue(tier, [5, 7, 9, 11]) }),
  generate(random, index, tier) {
    const target = (index + random(2)) % 2 === 0;
    const range = tier ? tierValue(tier, [30, 65, 110, 180]) : 70;
    const low = tier ? tierValue(tier, [2, 9, 23, 47]) : 2;
    let number = low + random(range);
    while (isPrime(number) !== target) number = low + ((number - low + 1) % range);
    return { text: number + " 是質數嗎？", solution: target ? "yes" : "no",
      options: [{ label: "是質數", value: "yes" }, { label: "不是質數", value: "no" }] };
  }
});

