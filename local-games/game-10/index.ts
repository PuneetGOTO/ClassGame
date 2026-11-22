import { arithmetic, quiz } from "../math";
import { tierValue } from "../../packages/shared/route";

export default quiz({ target: 8, count: 24, generate: arithmetic,
  course: tier => ({ target: tierValue(tier, [4, 6, 8, 10]) })
});

