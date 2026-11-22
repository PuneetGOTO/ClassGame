import { STATION_COUNT } from "./catalog";

export const ROUTE_LENGTH = STATION_COUNT;
export const ROUTE_TIER_SIZE = 5;
export const routeTiers = [1, 2, 3, 4] as const;
export type Difficulty = typeof routeTiers[number];
export const difficultyLabel: Record<Difficulty, string> = {
  1: "入門", 2: "進階", 3: "高難", 4: "決賽"
};
export function routeTier(step: number): Difficulty {
  return routeTiers[Math.floor((step - 1) / ROUTE_TIER_SIZE)];
}
export const tierValue = <T>(tier: Difficulty, values: readonly [T, T, T, T]) => values[tier - 1];
export const routePoints = (tier: Difficulty) => ({ win: tier * 2, loss: tier });

