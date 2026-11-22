/** Correct answers break bricks, adapted from hajunho/zeli-web-games MathBreakout (Apache-2.0).
 *  The personal route gives each player a seeded question stream and a difficulty-based brick target.
 */
import { arithmetic, quiz } from "../math";
import { tierValue } from "../../packages/shared/route";

export default quiz({ target: 1, count: 32, brickTarget: 15, generate: arithmetic,
  course: tier => ({ brickTarget: tierValue(tier, [4, 6, 8, 11]) })
});

