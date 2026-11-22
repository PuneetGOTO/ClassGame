export const FLOORS = [3, 4] as const;
export type Floor = typeof FLOORS[number];
export const floorLabel: Record<Floor, string> = { 3: "三樓", 4: "四樓" };
export const originalPhotoSize = {
  3: { width: 1804, height: 1280 },
  4: { width: 1862, height: 1279 }
} as const;

export const floorPlanFrame = {
  3: { x: 386, y: 110, width: 1200, height: 1112 },
  4: { x: 433, y: 52, width: 1170, height: 1148 }
} as const;

export function planPosition(floor: Floor, photoX: number, photoY: number) {
  const photo = originalPhotoSize[floor];
  const frame = floorPlanFrame[floor];
  const percent = (value: number, size: number, start: number, span: number) =>
    Math.round(100 * Math.max(0, Math.min(100, (value * size / 100 - start) * 100 / span))) / 100;
  return [percent(photoX, photo.width, frame.x, frame.width), percent(photoY, photo.height, frame.y, frame.height)] as const;
}

// Positions are percentages of the supplied photographs, measured from their top-left corners.
export const originalFloorStations: readonly [Floor, string, number, number][] = [
  [3, "301 室", 83.6, 26.6], [3, "302 室", 83.6, 40.2], [3, "303 室", 83.3, 53.3],
  [3, "305 室", 82.6, 81.0], [3, "306 室", 72.1, 81.3], [3, "307 室", 70.7, 52.9],
  [3, "308 室", 71.2, 40.2], [3, "309 室", 71.2, 26.8], [3, "311 室", 55.5, 70.7],
  [3, "312 室", 42.1, 72.2], [4, "401 室", 73.0, 44.6], [4, "405 室", 80.2, 76.5],
  [4, "406 室", 70.4, 79.4], [4, "408 室", 55.1, 87.1], [4, "409 室", 46.2, 87.2],
  [4, "410 室", 38.3, 88.7], [4, "411 室", 29.4, 87.2], [4, "413 室", 41.8, 67.8],
  [4, "414 室", 54.5, 68.3], [4, "415 室", 67.5, 11.8]
];

