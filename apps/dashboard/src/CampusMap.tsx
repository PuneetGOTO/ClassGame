import { useState } from "react";
import { QrCode } from "@phosphor-icons/react";
import { gameById } from "../../../packages/shared/catalog";
import { floorLabel, type Floor } from "../../../packages/shared/floors";
import { Dialog, numberOf, StationStatus } from "../../../packages/ui/components";
import { FloorChooser, FloorGraphic } from "../../../packages/ui/floor-map";
import type { CampusConnection } from "../../../packages/ui/network";

export function CampusMap({ connection }: { connection: CampusConnection }) {
  const { state } = connection;
  const [floor, setFloor] = useState<Floor>(() => new URLSearchParams(location.search).get("floor") === "4" ? 4 : 3);
  const [routeStation] = useState(() => new URLSearchParams(location.search).get("station"));
  const [selectedId, setSelectedId] = useState<string>();
  const list = state?.stations.filter(station => station.floor === floor) ?? [];
  const selected = list.find(station => station.id === selectedId);
  const selectFloor = (level: Floor) => {
    const url = new URL(location.href);
    url.searchParams.set("floor", String(level));
    history.replaceState(null, "", url);
    setFloor(level);
    setSelectedId(undefined);
  };
  return <main id="main" className="shell floor-dashboard">
    <h1 className="sr-only">樓層地圖</h1>
    <FloorChooser floor={floor} select={selectFloor} compact/>
    <div className="floor-canvas" data-floor={floor} data-enter>
      <FloorGraphic key={floor} floor={floor} override={state?.floorMaps[floor]}/>
      {list.map(station => {
        const roomNumber = /^\d{3}(?=\s|室|$)/.exec(station.name)?.[0] ?? numberOf(station.id);
        const status = station.online && station.open ? station.activity ? "busy" : "ready" : "";
        return <button type="button" className={"map-marker " + status}
          key={station.id} style={{ left: station.x + "%", top: station.y + "%" }}
          data-destination={station.id === routeStation}
          aria-label={station.name + " · " + gameById.get(station.gameId)?.name} title={station.name}
          onClick={() => setSelectedId(station.id)}>{roomNumber}</button>;
      })}
    </div>
    {selected && <Dialog title={floorLabel[floor] + " " + selected.name} onClose={() => setSelectedId(undefined)}>
      <div className="section-line map-room-details">
        <strong>{gameById.get(selected.gameId)?.name}</strong><StationStatus station={selected}/>
      </div>
      <p className="with-icon muted"><QrCode size={21}/> 到房間掃描大螢幕上的最新 QR Code 入場。</p>
    </Dialog>}
  </main>;
}

