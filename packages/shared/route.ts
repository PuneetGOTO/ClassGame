export const ROUTE_LENGTH = 10;
export const LEGACY_ROUTE_LENGTH = 20;
export const LEGACY_TIER_SIZE = 5;
export const routeTiers = [1, 2, 3, 4] as const;
export const routeTierSizes = [2, 3, 3, 2] as const;
export type Difficulty = typeof routeTiers[number];
export const difficultyLabel: Record<Difficulty, string> = {
  1: "入門", 2: "進階", 3: "高難", 4: "決賽"
};
export function routeTier(step: number): Difficulty {
  if (step <= 2) return 1;
  if (step <= 5) return 2;
  return step <= 8 ? 3 : 4;
}
export const tierValue = <T>(tier: Difficulty, values: readonly [T, T, T, T]) => values[tier - 1];
export const routePoints = (tier: Difficulty) => ({ win: tier * 2, loss: tier });
export const ROUTE_MAX_BASE_SCORE = routeTiers.reduce((sum, tier, index) => sum + routeTierSizes[index] * routePoints(tier).win, 0);

export type MatchMode = "duel" | "free-for-all" | "doubles";
export const modeTitle: Record<MatchMode, string> = { duel: "1 對 1", "free-for-all": "三人對戰", doubles: "2 對 2" };
export const sideLabels = ["藍方", "橙方", "綠方"] as const;

