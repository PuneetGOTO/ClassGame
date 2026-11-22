import { useState } from "react";
import { QrCode } from "@phosphor-icons/react";
import { gameById } from "../../../packages/shared/catalog";
import { floorLabel, type Floor } from "../../../packages/shared/floors";
import { Dialog, numberOf, StationStatus } from "../../../packages/ui/components";
import { KawaiiSnowman } from "../../../packages/ui/christmas-art";
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
    <section className="xmas-map-banner" data-enter>
      <div className="xmas-map-banner-left">
        <KawaiiSnowman size={54}/>
        <div>
          <h1>聖誕闖關地圖</h1>
        </div>
      </div>
      <div className="xmas-map-legend" aria-label="教室狀態說明">
        <span><i style={{ background: "#1d7a52" }}/> 可加入</span>
        <span><i style={{ background: "#d97706" }}/> 使用中</span>
        <span><i style={{ background: "#6c8299" }}/> 未開放</span>
      </div>
    </section>
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

