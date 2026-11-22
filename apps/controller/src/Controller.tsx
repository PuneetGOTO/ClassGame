import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight, Check, CircleNotch, DoorOpen, Flag, GameController, ListChecks, MapPin, UsersThree, Trophy,
  PuzzlePiece, Compass, Calculator, QrCode
} from "@phosphor-icons/react";
import { categoryLabel, gameById, TEAM_SIZE } from "../../../packages/shared/catalog";
import { floorLabel } from "../../../packages/shared/floors";
import type { Action, PlayerView, RoomView, Result, StationView } from "../../../packages/shared/protocol";
import { difficultyLabel, ROUTE_LENGTH, ROUTE_TIER_SIZE, routePoints, routeTiers } from "../../../packages/shared/route";
import { Dialog, DoubleBanner, Empty, ErrorText, fmtChange, fmtScore, numberOf, RoomClock, StationStatus, TeamTag } from "../../../packages/ui/components";
import { GameControls, MissionProgress, SceneView } from "../../../packages/ui/game-view";
import { message, RemoteError, request, socket, type CampusConnection } from "../../../packages/ui/network";

const tokenKey = "campus.playerToken";
const entryStation = new URLSearchParams(location.search).get("station");
const iconFor = { puzzle: PuzzlePiece, adventure: Compass, math: Calculator };

function readEntryFragment() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const given = fragment.get("join");
  const code = fragment.get("scan");
  if (given) localStorage.setItem(tokenKey, given);
  if (given || code) history.replaceState(null, "", location.pathname + location.search);
  return code;
}

export function Controller({ connection }: { connection: CampusConnection }) {
  const { state: campus, offset, online } = connection;
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(() => Boolean(localStorage.getItem(tokenKey) || location.hash.includes("join=")));
  const [replaced, setReplaced] = useState(false);
  const [dismissed, setDismissed] = useState<string>();
  const [showLeave, setShowLeave] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [hasScan, setHasScan] = useState(() => new URLSearchParams(location.hash.slice(1)).has("scan"));
  const [scanAccepted, setScanAccepted] = useState(false);
  const [scanError, setScanError] = useState("");
  const scanProof = useRef<Promise<boolean> | null>(null);
  const joinedScan = useRef(false);
  const activeId = useRef<string | null>(null);
  const sequence = useRef(0);
  const roomRef = useRef<RoomView | null>(null);

  const update = useCallback((view: PlayerView) => {
    roomRef.current = view.room;
    if (activeId.current !== view.room?.id) {
      activeId.current = view.room?.id ?? null;
      sequence.current = view.room?.seq ?? 0;
    } else sequence.current = Math.max(sequence.current, view.room?.seq ?? 0);
    setPlayer(view);
  }, []);

  const enterScanned = useCallback(async (view: PlayerView) => {
    const proof = scanProof.current;
    if (!entryStation || !proof || !await proof || proof !== scanProof.current || joinedScan.current) return;
    if ((view.room?.stationId ?? view.queue?.stationId) === entryStation) {
      joinedScan.current = true;
      setScanError("");
      return;
    }
    if (view.room || view.queue) {
      setError("請先離開目前的場次或隊列，再進入掃描的房間");
      return;
    }
    try {
      update(await request("station:join", { stationId: entryStation }));
      joinedScan.current = true;
      setScanError("");
    } catch (failure) { setError(message(failure)); }
  }, [update]);

  useEffect(() => {
    let scanCode = readEntryFragment();
    async function restore() {
      if (entryStation && scanCode && !joinedScan.current) {
        const proof = request("station:scan", { stationId: entryStation, code: scanCode }).then(() => {
          if (proof === scanProof.current) {
            setScanAccepted(true);
            setScanError("");
          }
          return true;
        }).catch(failure => {
          if (proof === scanProof.current) {
            setScanAccepted(false);
            setScanError(message(failure));
          }
          return false;
        });
        scanProof.current = proof;
      }
      const token = localStorage.getItem(tokenKey);
      if (!token) { setRestoring(false); return; }
      try {
        const restored = await request("player:reconnect", { token });
        update(restored);
        setError("");
        await enterScanned(restored);
      } catch (failure) {
        if (failure instanceof RemoteError && failure.code === "invalid-token") {
          localStorage.removeItem(tokenKey);
          setPlayer(null);
        }
        setError(message(failure));
      } finally { setRestoring(false); }
    }
    function scanAgain() {
      const nextCode = readEntryFragment();
      if (!entryStation || !nextCode) return;
      scanCode = nextCode;
      scanProof.current = null;
      joinedScan.current = false;
      setHasScan(true);
      setScanAccepted(false);
      setScanError("");
      if (socket.connected) void restore();
    }
    function gameState(room: RoomView) {
      if (activeId.current !== room.id && !room.members.some(member => member.id === identity.current)) return;
      if (activeId.current !== room.id) { activeId.current = room.id; sequence.current = room.seq; }
      sequence.current = Math.max(sequence.current, room.seq);
      roomRef.current = room;
      setPlayer(previous => previous ? { ...previous, room } : previous);
    }
    function kicked({ message: reason, replaced }: { message: string; replaced: boolean }) {
      if (!replaced) localStorage.removeItem(tokenKey);
      setReplaced(replaced);
      setPlayer(null);
      roomRef.current = null;
      setRestoring(false);
      setError(reason);
      if (!replaced) socket.once("disconnect", () => queueMicrotask(() => socket.connect()));
    }
    const onError = (value: { error: string; code: string }) => setError(value.error);
    socket.on("connect", restore).on("player:update", update).on("game:state", gameState).on("game:start", gameState)
      .on("game:finish", gameState).on("game:timeout", gameState).on("player:kicked", kicked).on("system:error", onError);
    window.addEventListener("hashchange", scanAgain);
    if (socket.connected) void restore();
    return () => {
      socket.off("connect", restore).off("player:update", update).off("game:state", gameState).off("game:start", gameState)
        .off("game:finish", gameState).off("game:timeout", gameState).off("player:kicked", kicked).off("system:error", onError);
      window.removeEventListener("hashchange", scanAgain);
    };
  }, [update, enterScanned]);
  const identity = useRef<string | undefined>(undefined);
  identity.current = player?.player.id;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  function join(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (!socket.connected && !socket.active) socket.connect();
      const created = await request("player:join", { name, teamId: team || undefined });
      localStorage.setItem(tokenKey, created.token);
      update(created.state);
      await enterScanned(created.state);
    });
  }
  function send(action: Action) {
    const room = roomRef.current;
    if (!room || room.status !== "running" || !socket.connected) return;
    const seq = ++sequence.current;
    void request("game:input", { sessionId: room.id, seq, action }).catch(failure => {
      if (failure instanceof RemoteError && ["rate", "not-running"].includes(failure.code)) return;
      setError(message(failure));
    });
  }

  const routeStation = campus?.stations.find(station => station.id === entryStation);
  if (restoring && !player) return <main id="main" className="controller narrow"><Empty title="恢復手機連線中">
    {online ? "正在讀取玩家及場次" : "等待伺服器連線"}
  </Empty>{!online && <button className="button secondary full" onClick={() => { setRestoring(false); }}>返回登入</button>}</main>;
  if (!player) return <main id="main" className="controller narrow join-layout" data-enter>
    <section className="panel join-panel">
      <div className="feature-icon"><GameController size={30} weight="duotone"/></div>
      <p className="eyebrow">手機控制器</p>
      <h1>加入校園闖關</h1>
      <p className="muted">{routeStation ? floorLabel[routeStation.floor] + " " + routeStation.name + " · " + gameById.get(routeStation.gameId)?.name
        : "登記後會收到第一站。到指定房間掃描大螢幕的 QR Code 入場。"}</p>
      {scanAccepted && <p className="notice success">已掃描本站 QR Code，請完成登記。</p>}
      {entryStation && !hasScan && <p className="notice">請到房間掃描大螢幕上的最新 QR Code。</p>}
      <form onSubmit={join} className="form-stack">
        <label>玩家名稱<input name="playerName" maxLength={24} required value={name} onChange={event => setName(event.target.value)} placeholder="輸入你的名稱" autoComplete="nickname"/></label>
        <label>隊伍<select value={team} onChange={event => setTeam(event.target.value)}>
          <option value="">自動分隊</option>
          {campus?.leaderboard.teams.slice().sort((a,b) => a.id.localeCompare(b.id)).map(entry =>
            <option key={entry.id} disabled={entry.members.length >= TEAM_SIZE} value={entry.id}>{entry.name}　{entry.members.length}/5</option>)}
        </select></label>
        <ErrorText text={scanError || error}/>
        <button className="button primary full" type="submit" disabled={!online || busy || !name.trim()}>{busy ? <CircleNotch size={18}/> : "加入活動"} <ArrowRight size={18}/></button>
      </form>
      {replaced && <button type="button" className="button secondary full" onClick={() => location.reload()}>在這部裝置恢復連線</button>}
    </section>
  </main>;

  const room = player.room;
  const game = room ? gameById.get(room.gameId) : undefined;
  const roomStation = room && campus?.stations.find(station => station.id === room.stationId);
  const me = room?.members.find(member => member.id === player.player.id);
  const result = player.lastResult;
  const lastStation = player.queue && campus?.stations.find(station => station.id === player.queue!.stationId);
  const visibleResult = !room && !player.queue && result && dismissed !== result.sessionId;
  const nextStation = campus?.stations.find(station => station.id === player.route.next?.stationId);
  const showExit = () => setShowLeave(true);
  return <main id="main" className={"controller narrow" + (room?.status === "running" ? " controller-playing" : "")}>
    <div className="controller-id">
      <div><TeamTag id={player.player.teamId}/><strong>{player.player.name}</strong></div>
      <a className="controller-score" href="/leaderboard" title="即時排行榜"><Trophy size={18}/> <strong>{fmtScore(player.player.totalScore)}</strong> 分</a>
    </div>
    {!online && <p className="notice">正在重新連線，中央計時仍在進行</p>}
    <ErrorText text={error}/>
    {!room && !player.queue && <ErrorText text={scanError}/>}
    {room && game && room.status !== "cancelled" && <section className="panel play-panel">
      <div className="play-heading">
        <div><p className="eyebrow">{room.course && "第 " + room.course.step + " 關 · " + difficultyLabel[room.course.tier] + " · "}
          {roomStation ? floorLabel[roomStation.floor] + " " + roomStation.name : "站點 " + numberOf(room.stationId)}</p>
          <h1>{game.name}</h1></div>
        {(room.status === "running" || room.status === "countdown") && <div className="play-clock"><RoomClock room={room} offset={offset}/></div>}
      </div>
      {room.status === "lobby" && <>
        <p className="muted">{game.objective}</p>
        <button className={"button full " + (me?.ready ? "secondary" : "primary")} disabled={!online || busy} onClick={() => void run(async () => {
          update(await request("game:ready", { sessionId: room.id, ready: !me?.ready }));
        })}>{me?.ready ? "取消就緒" : "我已準備好"} <Check size={19}/></button>
      </>}
      {room.status === "countdown" && <div className="countdown-center"><p>即將開始</p><RoomClock room={room} offset={offset}/></div>}
      {room.status === "running" && <>
        {room.doubleChallenge && <DoubleBanner challenge={room.doubleChallenge} playerId={player.player.id} team={Boolean(room.teamId)} tier={room.course?.tier}/>}
        {room.scene && <SceneView scene={room.scene} onAction={me?.participated && !me.forfeited && online ? send : undefined}/>}
        {room.scene && me?.participated && !me.forfeited && online && <GameControls scene={room.scene} controls={game.controls} gameId={game.id} send={send}/>}
        <MissionProgress room={room}/>
      </>}
      {room.status === "finished" && <p className="notice">正在同步本場成績</p>}
      {room.status === "lobby" &&
        <button className="text-button" onClick={showExit} disabled={!online || busy}><DoorOpen size={16}/> 離開場次</button>}
    </section>}
    {room?.status === "cancelled" && <p className="notice">{room.reason === "lobby-expired" ? "候場時間已到，請重新掃描指定房間的 QR Code。" : "這個場次已取消。"}</p>}
    {player.queue && <section className="panel queue-panel">
      <div className="feature-icon"><UsersThree size={26}/></div><p className="eyebrow">正在排隊</p>
      <h1>{lastStation ? floorLabel[lastStation.floor] + " " + lastStation.name : player.queue.stationId}</h1>
      <p className="muted">第 {player.queue.position} 位 · 輪到你時會自動進入候場</p>
      <button className="button secondary" onClick={showExit} disabled={!online || busy}>離開隊列</button>
    </section>}
    {visibleResult && <section className={"panel result-panel " + (result.outcome === "win" ? "won" : "lost")}>
      <div className="feature-icon"><Flag size={30} weight="fill"/></div>
      <p className="eyebrow">{result.step && "第 " + result.step + " 關 · "}{gameById.get(result.gameId)?.name}</p>
      <h1>{result.outcome === "win" ? "闖關成功" : "挑戰失敗"}</h1>
      {result.doublePoints && <p className="double-result">×2 雙倍挑戰</p>}
      <p className={"result-points" + (result.awarded < 0 ? " negative-points" : "")}>{fmtChange(result.awarded)} <span>分</span></p>
      <p className="muted">已完成 {player.route.completed} / {ROUTE_LENGTH} 關 · 個人總分 {fmtScore(player.player.totalScore)}</p>
      <button className="button primary full" onClick={() => setDismissed(result.sessionId)}>
        {player.route.next ? "查看下一站" : "查看完成紀錄"} <ArrowRight size={18}/>
      </button>
    </section>}
    {!room && !player.queue && !visibleResult && <>
      <NextMission route={player.route} station={nextStation} showHistory={() => setShowHistory(true)}/>
      <div className="controller-footer"><button className="text-button" disabled={!online} onClick={() => { setTeam(player.player.teamId); setShowTeam(true); }}>
        <UsersThree size={17}/> 變更隊伍</button>
        <button className="text-button" disabled={!online || busy} onClick={() => void run(async () => {
          await request("player:leave", null); localStorage.removeItem(tokenKey); setPlayer(null); scanProof.current = null; setScanAccepted(false);
        })}><DoorOpen size={17}/> 登出此裝置</button></div>
    </>}
    {showHistory && <Dialog title="我的闖關紀錄" onClose={() => setShowHistory(false)}><GameHistory results={player.results}/></Dialog>}
    {showLeave && <Dialog title={player.queue ? "離開隊列" : "離開場次"} onClose={() => setShowLeave(false)}>
      <p className="muted">稍後可到同一個房間掃碼，繼續你的任務。</p>
      <button className="button danger full" disabled={busy} onClick={() => { setShowLeave(false); void run(async () => {
        const view = await request("station:leave", null);
        update(view);
        await enterScanned(view);
      }); }}>確認離開</button>
    </Dialog>}
    {showTeam && <Dialog title="變更隊伍" onClose={() => setShowTeam(false)}>
      <form className="form-stack" onSubmit={event => { event.preventDefault(); setShowTeam(false); void run(async () => update(await request("team:join", { teamId: team }))); }}>
        <label>選擇隊伍<select value={team} onChange={event => setTeam(event.target.value)} required>
          {campus?.leaderboard.teams.slice().sort((a,b) => a.id.localeCompare(b.id)).map(entry =>
            <option key={entry.id} disabled={entry.members.length >= TEAM_SIZE && entry.id !== player.player.teamId} value={entry.id}>{entry.name}　{entry.members.length}/5</option>)}
        </select></label><button className="button primary full" type="submit">儲存隊伍</button>
      </form>
    </Dialog>}
  </main>;
}

function NextMission({ route, station, showHistory }: { route: PlayerView["route"]; station?: StationView; showHistory: () => void }) {
  const { next, completed } = route;
  const game = next ? gameById.get(next.gameId) : undefined;
  const Icon = game ? iconFor[game.category] : Flag;
  const points = next && routePoints(next.tier);
  return <section className="panel route-card" aria-labelledby="route-heading" data-enter>
    <div className="section-line">
      <div><p className="eyebrow">個人闖關路線</p><h1 id="route-heading">{next ? "你的下一站" : "20 關全數完成"}</h1></div>
      <button type="button" className="icon-button" aria-label="我的闖關紀錄" onClick={showHistory}><ListChecks size={23}/></button>
    </div>
    <div className="route-progress">
      <div className="section-line"><span>已完成</span><strong>{completed} / {ROUTE_LENGTH} 關</strong></div>
      <div className="route-track" aria-hidden="true">
        {routeTiers.map(tier => <div key={tier} data-current={tier === next?.tier}>
          {Array.from({ length: ROUTE_TIER_SIZE }, (_, index) =>
            <i key={index} data-done={(tier - 1) * ROUTE_TIER_SIZE + index < completed}/>)}
        </div>)}
      </div>
    </div>
    {next && game && points ? <>
      <div className="route-mission">
        <div className={"row-icon tone-" + game.category}><Icon size={24} weight="duotone"/></div>
        <div><p className="eyebrow">第 {next.step} 關 · {difficultyLabel[next.tier]} · {categoryLabel[game.category]}</p>
          <h2>{game.name}</h2></div>
      </div>
      <p className="route-location"><MapPin size={22} weight="fill"/> {station ? floorLabel[station.floor] + " · " + station.name : next.stationId}</p>
      <p className="muted">{game.objective}</p>
      <div className="route-rules"><span>60 秒</span><span>勝利 +{points.win}</span><span>失敗 +{points.loss}</span></div>
      {station && <StationStatus station={station}/>}
      <p className="route-scan"><QrCode size={22}/> 到指定房間，用手機相機掃描大螢幕上的即時 QR Code。</p>
      <a className="button primary full" href={station ? "/?floor=" + station.floor + "&station=" + station.id : "/"}>
        查看房間位置 <ArrowRight size={18}/>
      </a>
    </> : <button className="button primary full" onClick={showHistory}>查看闖關紀錄 <ListChecks size={20}/></button>}
  </section>;
}

function GameHistory({ results }: { results: Result[] }) {
  if (!results.length) return <Empty title="暫無闖關紀錄"/>;
  return <div className="history-list">{results.toSorted((a, b) => (a.step ?? 0) - (b.step ?? 0)).map(result =>
    <div key={result.sessionId}><span>{result.step ?? "—"} · {gameById.get(result.gameId)?.name}</span><strong>
      {(result.outcome === "win" ? "勝 " : "負 ") + fmtChange(result.awarded) + (result.doublePoints ? " · 雙倍" : "")}
    </strong></div>)}</div>;
}

