import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight, Check, CircleNotch, DoorOpen, Flag, GameController, ListChecks, MapPin, UsersThree, Trophy,
  PuzzlePiece, Compass, Calculator, QrCode, Monitor
} from "@phosphor-icons/react";
import { categoryLabel, gameById, TEAM_SIZE } from "../../../packages/shared/catalog";
import { floorLabel } from "../../../packages/shared/floors";
import { studentNumberSchema, type Action, type PlayerView, type RoomView, type Result, type StationView } from "../../../packages/shared/protocol";
import { completedRouteSteps, difficultyLabel, modeTitle, sideLabels, ROUTE_LENGTH, routeTierSizes, routePoints, routeTiers } from "../../../packages/shared/route";
import { Countdown, Dialog, DoubleBanner, Empty, ErrorText, fmtChange, fmtScore, numberOf, RoomClock, ScreenPauseNotice, StationStatus, TeamTag } from "../../../packages/ui/components";
import { RotateGameNotice, useGameOrientation } from "../../../packages/ui/game-orientation";
import { GameControls, Members } from "../../../packages/ui/game-view";
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
  const [signInMode, setSignInMode] = useState<"student" | "nickname">("student");
  const [studentNumber, setStudentNumber] = useState("");
  const [accessCode, setAccessCode] = useState("");
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
    if (view.room?.stationId === entryStation && view.room.members.find(member => member.id === view.player.id)?.checkedIn) {
      joinedScan.current = true;
      setScanError("");
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
  const nicknameRegistration = campus?.selfRegistration === true;
  const useNickname = nicknameRegistration && signInMode === "nickname";
  function join(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (!socket.connected && !socket.active) socket.connect();
      const created = useNickname
        ? await request("player:join", { name, teamId: team || undefined })
        : await request("player:login", { studentNumber, code: accessCode });
      localStorage.setItem(tokenKey, created.token);
      setAccessCode("");
      setReplaced(false);
      update(created.state);
      await enterScanned(created.state);
    });
  }
  async function send(action: Action) {
    const room = roomRef.current;
    if (!room || room.status !== "running" || room.pausedAt != null || !socket.connected) return;
    const seq = ++sequence.current;
    try { await request("game:input", { sessionId: room.id, seq, action }); }
    catch (failure) {
      if (failure instanceof RemoteError && ["rate", "not-running", "answer-cooldown", "host-offline"].includes(failure.code)) return;
      setError(message(failure));
    }
  }

  const routeStation = campus?.stations.find(station => station.id === entryStation);
  const room = player?.room;
  const me = room?.members.find(member => member.id === player?.player.id);
  const showRemote = me?.checkedIn && room?.status !== "cancelled";
  const inRound = room?.status === "countdown" || room?.status === "running";
  const { portrait, lockLandscape } = useGameOrientation(Boolean(showRemote && room?.status !== "finished"));
  if (restoring && !player) return <main id="main" className="controller narrow"><Empty title="恢復手機連線中">
    {online ? "正在讀取玩家及場次" : "等待伺服器連線"}
  </Empty>{!online && <button className="button secondary full" onClick={() => { setRestoring(false); }}>返回登入</button>}</main>;
  if (!player) return <main id="main" className="controller narrow join-layout" data-enter>
    <section className="panel join-panel">
      <div className="feature-icon"><GameController size={30} weight="duotone"/></div>
      <p className="eyebrow">手機控制器</p>
      <h1>加入校園闖關</h1>
      <p className="muted">{routeStation ? floorLabel[routeStation.floor] + " " + routeStation.name + " · " + gameById.get(routeStation.gameId)?.name
        : "登入後尋找對手，再到指定房間掃碼入場。"}</p>
      {scanAccepted && <p className="notice success">已讀取本站入場碼。請登入以恢復場次。</p>}
      {entryStation && !hasScan && <p className="notice">配對後請到指定房間掃描最新的 QR Code。</p>}
      {nicknameRegistration && <div className="segmented sign-in-tabs" aria-label="入場方式">
        <button type="button" aria-pressed={!useNickname} onClick={() => { setSignInMode("student"); setError(""); }}>學號登入</button>
        <button type="button" aria-pressed={useNickname} onClick={() => { setSignInMode("nickname"); setAccessCode(""); setError(""); }}>暱稱登記</button>
      </div>}
      <form onSubmit={join} className="form-stack">
        {useNickname ? <>
          <label>玩家名稱<input name="playerName" maxLength={24} required value={name}
            onChange={event => setName(event.target.value)} placeholder="輸入你的名稱" autoComplete="nickname"/></label>
          <label>隊伍<select value={team} onChange={event => setTeam(event.target.value)}>
            <option value="">自動分隊</option>
            {campus?.leaderboard.teams.slice().sort((a,b) => a.id.localeCompare(b.id)).map(entry =>
              <option key={entry.id} disabled={entry.members.length >= TEAM_SIZE} value={entry.id}>{entry.name}　{entry.members.length}/5</option>)}
          </select></label>
        </> : <>
          <label>學生證號碼<input name="username" autoComplete="username" autoCapitalize="characters" spellCheck={false} type="text"
            maxLength={24} required value={studentNumber} onChange={event => setStudentNumber(event.target.value)} placeholder="按學生證輸入學號"/></label>
          <label>登入碼<input name="password" type="password" inputMode="numeric" autoComplete="current-password" maxLength={8}
            required value={accessCode} onChange={event => setAccessCode(event.target.value)} placeholder="管理員提供的 8 位數字"/></label>
        </>}
        <ErrorText text={scanError || error}/>
        <button className="button primary full" type="submit" disabled={!online || busy ||
          (useNickname ? !name.trim() : !studentNumberSchema.safeParse(studentNumber).success || !/^\d{8}$/.test(accessCode))}>
          {busy ? <CircleNotch size={18}/> : useNickname ? "加入活動" : "登入活動"} <ArrowRight size={18}/></button>
      </form>
      {replaced && <button type="button" className="button secondary full" onClick={() => location.reload()}>在這部裝置恢復連線</button>}
    </section>
  </main>;

  const game = room ? gameById.get(room.gameId) : undefined;
  const roomStation = room && campus?.stations.find(station => station.id === room.stationId);
  const result = player.lastResult;
  const visibleResult = !room && !player.route.searching && result && dismissed !== result.sessionId;
  const nextStation = campus?.stations.find(station => station.id === player.route.next?.stationId);
  const showExit = () => setShowLeave(true);
  return <main id="main" className={"controller narrow" + (showRemote ? " controller-match" : "")}
    data-round={showRemote ? room?.status : undefined}>
    <div className="controller-id">
      <div><TeamTag id={player.player.teamId}/><strong>{player.player.name}</strong></div>
      <a className="controller-score" href="/leaderboard" title="即時排行榜"><Trophy size={18}/> <strong>{fmtScore(player.player.totalScore)}</strong> 分</a>
    </div>
    {!online && <p className="notice">正在重新連接伺服器</p>}
    <ErrorText text={error || (!showRemote ? scanError : "")}/>
    {room && game && showRemote && <section className="panel play-panel remote-panel">
      <div className="play-heading">
        <div><p className="eyebrow">{me?.assisting ? "陪打 · " : room.course && "第 " + room.course.step + " 關 · " + difficultyLabel[room.course.tier] + " · "}
          {roomStation ? floorLabel[roomStation.floor] + " " + roomStation.name : "站點 " + numberOf(room.stationId)}</p>
          <h1>{game.name}</h1></div>
        {inRound && <div className="play-clock"><RoomClock room={room} offset={offset}/></div>}
      </div>
      {inRound && me?.side != null && <div className="remote-player" data-side={me.side}>
        <strong>P{me.position} · {sideLabels[me.side]}</strong>
        <span><Monitor size={18}/> 看大螢幕操作</span>
      </div>}
      {room.pausedAt != null && <ScreenPauseNotice at={room.pausedAt} offset={offset}/>}
      {portrait && (inRound || room.status === "lobby") && <RotateGameNotice lockLandscape={lockLandscape}/>}
      {room.status === "lobby" && <>
        <div className="section-line"><h2>{room.match && modeTitle[room.match.mode]}</h2>
          <span className="muted">報到倒數 <Countdown end={room.match?.arrivalDeadline} offset={offset}/></span></div>
        <Members room={room} self={player.player.id}/>
        <button className={"button full " + (me?.ready ? "secondary" : "primary")} disabled={!online || busy || (portrait && !me?.ready)} onClick={() => void run(async () => {
          update(await request("game:ready", { sessionId: room.id, ready: !me?.ready }));
        })}>{me?.ready ? "取消就緒" : "我已準備好"} <Check size={19}/></button>
        <p className="muted small">{game.minPlayers === 4 ? "四位玩家都到場並就緒才可開局。" : "至少兩位玩家到場並就緒才可開局。"}</p>
      </>}
      {room.status === "countdown" && <div className="countdown-center"><p>即將開始</p><RoomClock room={room} offset={offset}/></div>}
      {room.status === "running" && <>
        {!portrait && me?.participated && !me.forfeited && online && room.pausedAt == null &&
          <GameControls key={room.id} remote={room.match?.remote ?? {}} controls={game.controls} gameId={game.id} offset={offset} send={send}/>}
        {room.doubleChallenge && <DoubleBanner challenge={room.doubleChallenge} playerId={player.player.id} team={false}/>}
        <p className="muted small">{me?.assisting ? "本場陪打記 0 分。" : "每位玩家須操作，這場才會計入個人關卡。"}</p>
      </>}
      {room.status === "finished" && <p className="notice">正在同步本場成績</p>}
      {room.status === "lobby" &&
        <button className="text-button" onClick={showExit} disabled={!online || busy}><DoorOpen size={16}/> 離開場次</button>}
    </section>}
    {visibleResult && <section className={"panel result-panel " + (result.outcome === "win" ? "won" : result.tied ? "" : "lost")} data-enter>
      <div className="feature-icon"><Flag size={30} weight="fill"/></div>
      <p className="eyebrow">{result.assisting ? "陪打 · " : result.step && "第 " + result.step + " 關 · "}{gameById.get(result.gameId)?.name}</p>
      <h1 aria-live="polite">{result.tied ? "本場平手" : result.assisting ? result.outcome === "win" ? "陪打獲勝" : "陪打落敗"
        : result.outcome === "win" ? "闖關成功" : "挑戰失敗"}</h1>
      {result.doublePoints && <p className="double-result">×2 雙倍挑戰</p>}
      <p className={"result-points" + (result.awarded < 0 ? " negative-points" : "")}>{fmtChange(result.awarded)} <span>分</span></p>
      <p className="muted">已完成 {player.route.completed} / {ROUTE_LENGTH} 關 · 個人總分 {fmtScore(player.player.totalScore)}</p>
      <button className="button primary full" onClick={() => setDismissed(result.sessionId)}>
        {result.assisting || player.route.completed >= ROUTE_LENGTH ? "返回闖關頁" : "繼續闖關"} <ArrowRight size={18}/>
      </button>
    </section>}
    {!showRemote && !visibleResult && <>
      <NextMission route={player.route} results={player.results} station={nextStation} room={room?.status === "lobby" ? room : null} offset={offset}
        busy={busy || !online} showHistory={() => setShowHistory(true)}
        start={() => void run(async () => update(await request("match:find", null)))}
        assist={() => void run(async () => update(await request("match:assist", null)))}
        cancel={() => void run(async () => update(await request("match:cancel", null)))}/>
      <div className="controller-footer"><button className="text-button" disabled={!online} onClick={() => { setTeam(player.player.teamId); setShowTeam(true); }}>
        <UsersThree size={17}/> 變更隊伍</button>
        <button className="text-button" disabled={!online || busy} onClick={() => void run(async () => {
          await request("player:leave", null); localStorage.removeItem(tokenKey); setPlayer(null); scanProof.current = null; setScanAccepted(false);
        })}><DoorOpen size={17}/> 登出此裝置</button></div>
    </>}
    {showHistory && <Dialog title="我的闖關紀錄" onClose={() => setShowHistory(false)}><GameHistory results={player.results}/></Dialog>}
    {showLeave && <Dialog title="離開候場" onClose={() => setShowLeave(false)}>
      <p className="muted">離開後可重新尋找對手。</p>
      <button className="button danger full" disabled={busy} onClick={() => { setShowLeave(false); void run(async () => {
        const view = await request("station:leave", null);
        update(view);
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

function NextMission({ route, results, station, room, offset, busy, showHistory, start, assist, cancel }: {
  route: PlayerView["route"]; results: Result[]; station?: StationView; room: RoomView | null; offset: number; busy: boolean;
  showHistory: () => void; start: () => void; assist: () => void; cancel: () => void;
}) {
  const { next, completed, assisting } = route;
  const done = completed >= ROUTE_LENGTH;
  const completedSteps = completedRouteSteps(results.map(result => result.step));
  const game = next ? gameById.get(next.gameId) : undefined;
  const Icon = game ? iconFor[game.category] : Flag;
  const points = next && routePoints(next.tier);
  return <section className="panel route-card" aria-labelledby="route-heading" data-enter>
    <div className="section-line">
      <div><p className="eyebrow">校園對戰</p><h1 id="route-heading">
        {next ? "前往對戰房間" : route.searching ? assisting ? "等候陪打配對" : "正在尋找對手" : done ? "10 關全數完成" : "準備下一關"}
      </h1></div>
      <button type="button" className="icon-button" aria-label="我的闖關紀錄" onClick={showHistory}><ListChecks size={23}/></button>
    </div>
    <div className="route-progress">
      <div className="section-line"><span>已完成</span><strong>{completed} / {ROUTE_LENGTH} 關</strong></div>
      <div className="route-track" aria-hidden="true">
        {routeTiers.map((tier, group) => <div key={tier} data-current={tier === next?.tier} style={{ flex: routeTierSizes[group] }}>
          {Array.from({ length: routeTierSizes[group] }, (_, index) =>
            <i key={index} data-done={completedSteps.has(routeTierSizes.slice(0, group).reduce<number>((sum, count) => sum + count, 0) + index + 1)}/>)}
        </div>)}
      </div>
    </div>
    {next && game && points ? <>
      <div className="route-mission">
        <div className={"row-icon tone-" + game.category}><Icon size={24} weight="duotone"/></div>
        <div><p className="eyebrow">{assisting ? "陪打" : "第 " + next.step + " 關"} · {difficultyLabel[next.tier]} · {categoryLabel[game.category]}</p>
          <h2>{game.name}</h2></div>
      </div>
      <p className="route-location"><MapPin size={22} weight="fill"/> {station ? floorLabel[station.floor] + " · " + station.name : next.stationId}</p>
      {room?.match && <div className="section-line"><strong>{modeTitle[room.match.mode]}</strong>
        <span className="muted">報到倒數 <Countdown end={room.match.arrivalDeadline} offset={offset}/></span></div>}
      <p className="muted">{game.objective}</p>
      <div className="route-rules"><span>60 秒</span>{assisting ? <span>陪打記 0 分</span>
        : <><span>勝利 +{points.win}</span><span>失敗 +{points.loss}</span></>}</div>
      {station && <StationStatus station={station}/>}
      <p className="route-scan"><QrCode size={22}/> 到指定房間，用手機相機掃描大螢幕上的即時 QR Code。</p>
      <a className="button primary full" href={station ? "/?floor=" + station.floor + "&station=" + station.id : "/"}>
        查看房間位置 <ArrowRight size={18}/>
      </a>
      <button type="button" className="text-button" disabled={busy} onClick={cancel}>取消配對</button>
    </> : route.searching ? <>
        <p className="muted" role="status"><CircleNotch size={18}/> {assisting ? "正在等候需要對手的玩家。陪打記 0 分。"
          : "正在找玩家和可用的房間。配對後手機會顯示房號。"}</p>
        <button className="button secondary full" disabled={busy} onClick={cancel}>{assisting ? "取消陪打" : "取消尋找"}</button>
      </> : <>
        {done ? <button className="button primary full" onClick={showHistory}>查看闖關紀錄 <ListChecks size={20}/></button>
          : <><p className="muted">配對後到房間掃碼。看著大螢幕，用手機控制你的角色或作答。</p>
            <button className="button primary full" disabled={busy} onClick={start}>尋找對手 <ArrowRight size={18}/></button></>}
        <button className="button secondary full" disabled={busy} onClick={assist}>報名陪打 <UsersThree size={18}/></button>
      </>}
  </section>;
}

function GameHistory({ results }: { results: Result[] }) {
  if (!results.length) return <Empty title="暫無闖關紀錄"/>;
  return <div className="history-list">{results.toSorted((a, b) => (a.step ?? 0) - (b.step ?? 0)).map(result =>
    <div key={result.sessionId}><span>{result.step ?? "—"} · {gameById.get(result.gameId)?.name}</span><strong>
      {(result.tied ? "和 " : result.outcome === "win" ? "勝 " : "負 ") + fmtChange(result.awarded) + (result.doublePoints ? " · 雙倍" : "")}
    </strong></div>)}</div>;
}

