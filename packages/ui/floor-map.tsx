import { useLayoutEffect, useRef, useState } from "react";
import { FLOORS, floorLabel, floorPlanFrame, type Floor } from "../shared/floors";
import type { FloorMapStatus, StationView } from "../shared/protocol";
import { drawFloorPlan } from "./floor-plan";

export function FloorChooser({ floor, select, stations, compact = false }: {
  floor: Floor; select: (floor: Floor) => void; stations?: StationView[]; compact?: boolean
}) {
  return <div className="floor-chooser" role="group" aria-label="選擇樓層">
    {FLOORS.map(level => <button key={level} type="button" aria-pressed={floor === level} data-floor={level} onClick={() => select(level)}>
      {compact ? <strong>{level} 樓</strong> : <><strong>{level}F</strong><span>{floorLabel[level]}</span></>}
      {stations && <small>{stations.filter(station => station.floor === level).length} 站</small>}
    </button>)}
  </div>;
}

export function FloorGraphic({ floor, override }: { floor: Floor; override?: FloorMapStatus }) {
  const [failedUrl, setFailedUrl] = useState("");
  const custom = override?.custom ? "/api/map/" + floor + "?v=" + override.revision : "";
  if (custom && custom !== failedUrl) return <img className="floor-image" src={custom} alt={floorLabel[floor] + "平面圖"} draggable={false}
    onError={() => setFailedUrl(custom)}/>;
  return <PlanCanvas floor={floor}/>;
}

function PlanCanvas({ floor }: { floor: Floor }) {
  const { width, height } = floorPlanFrame[floor];
  const surface = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const context = surface.current?.getContext("2d");
    if (context) drawFloorPlan(context, floor);
  }, [floor]);
  return <canvas className="floor-image" role="img" aria-label={floorLabel[floor] + "平面圖"} ref={surface} width={width} height={height}/>;
}

