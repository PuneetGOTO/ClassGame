import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ArrowsOut, Monitor, QrCode, UsersThree } from "@phosphor-icons/react";
import { fixedId, gameById, STATION_COUNT } from "../../../packages/shared/catalog";
import { floorLabel } from "../../../packages/shared/floors";
import { HOST_SCREEN_VERSION } from "../../../packages/shared/rules";
import type { HostView, Result, RoomView, StationEntry, TeamResult } from "../../../packages/shared/protocol";
import { modeTitle, sideLabels } from "../../../packages/shared/route";
import { Brand, CandyCaneTimerBar, Countdown, DoubleBanner, ErrorText, fmtChange, HomeLink, RotatingQr, RoomClock, StationStatus, Status } from "../../../packages/ui/components";
import { KawaiiReindeer, KawaiiSnowman } from "../../../packages/ui/christmas-art";
import { ArenaPanels, Members, RoundOutcome, SideNames } from "../../../packages/ui/game-view";
import { message, request, socket, type CampusConnection } from "../../../packages/ui/network";

const savedHost = "campus.host";
const requestedHost = new URLSearchParams(location.search).get("id");
const hosts = Array.from({ length: STATION_COUNT }, (_, index) => fixedId("HOST", index + 1));
const stored = (id: string) => localStorage.getItem("campus.key." + id) || "";

export function Host({ connection }: { connection: CampusConnection }) {
  const { online, offset } = connection;
  const [id, setId] = useState(requestedHost && hosts.includes(requestedHost) ? requestedHost : localStorage.getItem(savedHost) || hosts[0]);
  const [key, setKey] = useState(() => stored(id));
  const [host, setHost] = useState<HostView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const playing = host?.room?.status === "countdown" || host?.room?.status === "running";
  useEffect(() => { if (playing) window.scrollTo(0, 0); }, [playing]);
  const connect = useCallback(async (hostId: string, password: string) => {
    if (!password) return;
    setBusy(true);
    try {
      const view = await request("host:register", { hostId, key: password, entryOrigin: location.origin, screenVersion: HOST_SCREEN_VERSION });
      localStorage.setItem(savedHost, hostId);
      localStorage.setItem("campus.key." + hostId, password);
      setHost(view);
      setError("");
    } catch (failure) { setError(message(failure)); setHost(null); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    const restore = () => { const secret = stored(id); if (secret) void connect(id, secret); };
    const scene = (room: RoomView) => setHost(previous => previous && room.hostId === previous.hostId ? {
      ...previous, room, results: previous.room?.id === room.id ? previous.results : [],
      teamResult: previous.room?.id === room.id ? previous.teamResult : null
    } : previous);
    const result = (item: Result) => setHost(previous => previous?.room?.id === item.sessionId ? {
      ...previous, results: previous.results.filter(entry => entry.playerId !== item.playerId).concat(item)
    } : previous);
    const team = (item: TeamResult) => setHost(previous => previous?.room?.id === item.sessionId ? { ...previous, teamResult: item } : previous);
    const entry = (value: StationEntry | null) => setHost(previous => previous &&
      (!value || value.stationId === previous.station.id) ? { ...previous, entry: value } : previous);
    const issue = ({ error, code }: { error: string; code: string }) => {
      setError(error);
      if (code === "host-replaced") setHost(null);
    };
    socket.on("connect", restore).on("host:status", setHost).on("host:entry", entry).on("game:state", scene).on("game:start", scene).on("game:finish", scene)
      .on("game:timeout", scene).on("score:result", result).on("score:team-average", team).on("system:error", issue);
    if (socket.connected) restore();
    return () => {
      socket.off("connect", restore).off("host:status", setHost).off("host:entry", entry).off("game:state", scene).off("game:start", scene).off("game:finish", scene)
        .off("game:timeout", scene).off("score:result", result).off("score:team-average", team).off("system:error", issue);
    };
  }, [id, connect]);
  if (!host) return <main id="main" className="narrow join-layout" data-enter><section className="panel join-panel">
    <div className="xmas-login-mascots">
      <KawaiiSnowman size={50}/>
      <p>校園聖誕闖關</p>
      <KawaiiReindeer size={50}/>
    </div>
    <div className="feature-icon"><Monitor size={30} weight="duotone"/></div><p className="eyebrow">固定大螢幕</p>
    <h1>登記遊戲主機</h1><p className="muted">選擇此螢幕的主機編號，並輸入管理後台提供的專屬金鑰。</p>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); if (!socket.connected && !socket.active) socket.connect(); else void connect(id, key); }}>
      <label>主機編號<select value={id} onChange={event => { setId(event.target.value); setKey(stored(event.target.value)); }}>
        {hosts.map(hostId => <option key={hostId}>{hostId}</option>)}
      </select></label>
      <label>主機金鑰<input type="password" required autoComplete="current-password" value={key} onChange={event => setKey(event.target.value)} placeholder="輸入此主機的金鑰"/></label>
      <ErrorText text={error}/>
      <button type="submit" className="button primary full" disabled={busy || !key.trim()}>連線至站點 <ArrowRight size={18}/></button>
    </form>
    <HomeLink/>
  </section></main>;

  const { station, room } = host;
  const live = online && !busy;
  const game = gameById.get(room?.gameId ?? station.gameId)!;
  const mode = room?.match ? modeTitle[room.match.mode] : null;
  const exit = () => {
    localStorage.removeItem("campus.key." + id);
    socket.disconnect();
    location.assign("/host");
  };
  return <main id="main" className="host-display shell" data-playing={playing}>
    <header className="host-top">
      <Brand/><div className="host-meta"><strong>{host.hostId}</strong><span>{floorLabel[station.floor]} · {station.name}</span></div>
      <div className="host-top-actions"><Status online={live} label={live ? "主機在線" : "正在重連"}/>
        <button className="icon-button" aria-label="切換全螢幕" onClick={() => {
          const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
          void action.catch(() => setError("瀏覽器目前無法切換全螢幕"));
        }}><ArrowsOut size={21}/></button>
        <button className="button compact secondary" onClick={exit}>登出主機</button></div>
    </header>
    <ErrorText text={error}/>
    <div className="host-layout">
      <section className="panel host-game">
        <div className="host-title"><div><p className="eyebrow">{mode ?? game.english}</p><h1>{game.name}</h1></div>
          <div className="host-clock"><RoomClock room={live ? room : null} offset={offset}/><span>{room?.status === "countdown" ? "開始倒數" : "剩餘時間"}</span></div>
        </div>
        <CandyCaneTimerBar room={live ? room : null} offset={offset}/>
        {!live && playing &&
          <p className="notice" role="status">大螢幕連線中斷，正在重連。</p>}
        {(room?.status === "running" || room?.status === "finished") && room.doubleChallenge &&
          <DoubleBanner challenge={room.doubleChallenge} team={false}/>}
        {room?.status === "running" ? <ArenaPanels panels={room.match?.panels ?? []} members={room.members}/>
          : room?.status === "countdown" ? <div className="host-stage countdown-center"><span>拿好手機，準備開局</span><RoomClock room={live ? room : null} offset={offset}/>
            <SideRoster room={room}/></div>
          : room?.status === "finished" ? <RoundOutcome winner={room.match?.winner ?? null} panels={room.match?.panels}
            reason={room.reason === "goal" || room.reason === "completed" || room.reason === "timeout" ? room.reason : null}/>
          : <div className="host-stage idle"><div className="xmas-idle-mascots"><KawaiiSnowman size={74}/><KawaiiReindeer size={74}/></div>
            <h2>{room?.status === "lobby" ? "等候玩家掃碼及就緒" : "等待配對玩家"}</h2>
            {room?.match && <p>報到倒數 <Countdown end={room.match.arrivalDeadline} offset={offset}/></p>}
            <p>{game.objective}</p><StationStatus station={station}/></div>}
      </section>
      {!playing && <aside className="host-aside">
        <section className="panel host-join"><div className="section-line"><h2><QrCode size={21}/> 手機入場</h2></div>
          <RotatingQr entry={live && station.open ? host.entry : null} offset={offset}
            unavailable={!station.open ? "暫停入場" : !live ? "等待主機連線" : undefined}>
            {station.open && <p>用手機相機掃描本站 QR Code</p>}
          </RotatingQr>
          <span>{station.name}{room?.status === "lobby" && " · " + station.queued + " 人尚未到場"}</span>
        </section>
        <section className="panel host-members"><div className="section-line"><h2><UsersThree size={21}/> 參賽者</h2></div>
          {host.results.length > 0 ? <div className="history-list">{host.results.map(result => <div key={result.playerId}><span>{result.playerName}</span>
            <strong className={result.awarded < 0 ? "negative-points" : undefined}>{result.assisting ? "陪打 · 0 分" : result.participated
              ? (result.tied ? "和 " : result.outcome === "win" ? "勝 " : "負 ") + fmtChange(result.awarded) + (result.doublePoints ? " · 雙倍" : "")
              : "未計分"}</strong></div>)}</div>
          : room ? <Members room={room}/> : <p className="muted">等待玩家加入場次</p>}
        </section>
      </aside>}
    </div>
  </main>;
}

function SideRoster({ room }: { room: RoomView }) {
  const sides = [...new Set(room.members.flatMap(member => member.side === null ? [] : [member.side]))].sort();
  return <div className="host-side-roster">{sides.map(side => <div key={side} data-side={side}>
    <strong>{sideLabels[side]}</strong><SideNames members={room.members} side={side}/>
  </div>)}</div>;
}

