import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsOut, GameController, Monitor, QrCode } from "@phosphor-icons/react";
import { GAMES, categoryLabel, gameById, type Category } from "../../../packages/shared/catalog";
import { practiceNames, practiceSeats, type PracticeRole, type PracticeView } from "../../../packages/shared/practice";
import type { Action } from "../../../packages/shared/protocol";
import { sideLabels } from "../../../packages/shared/route";
import { Brand, ErrorText, RotatingQr, RoomClock, ScreenPauseNotice, Status } from "../../../packages/ui/components";
import { ArenaPanels, GameControls, RoundOutcome } from "../../../packages/ui/game-view";
import { RemoteError, message, request, socket, type CampusConnection } from "../../../packages/ui/network";

const roleParam = new URLSearchParams(location.search).get("role");
const role: PracticeRole = roleParam === "P1" || roleParam === "P2" ? roleParam : "screen";
const storageKey = "campus.practice." + role;
const players = practiceSeats.map((seat, index) => ({ id: seat, name: practiceNames[seat], position: index + 1, side: index }));

export function Practice({ connection }: { connection: CampusConnection }) {
  const { online, offset } = connection;
  const [view, setView] = useState<PracticeView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(true);
  const active = useRef<PracticeView | null>(null);
  const seq = useRef(0);

  const update = useCallback((next: PracticeView) => {
    seq.current = active.current?.round?.id === next.round?.id ? Math.max(seq.current, next.seq) : next.seq;
    active.current = next;
    setView(next);
  }, []);
  useEffect(() => {
    let live = true;
    let revision = 0;
    let token = sessionStorage.getItem(storageKey);
    function readScan() {
      const scanned = new URLSearchParams(location.hash.slice(1)).get("key");
      if (!scanned) return false;
      history.replaceState(null, "", location.pathname + location.search);
      token = scanned;
      return true;
    }
    function clearCredential() {
      token = null;
      active.current = null;
      sessionStorage.removeItem(storageKey);
      setView(null);
    }
    function restore() {
      if (!token) { setJoining(false); return; }
      const current = ++revision;
      setJoining(true);
      void request("practice:join", { role, credential: token, entryOrigin: location.origin }).then(result => {
        if (!live || current !== revision) return;
        token = result.token;
        sessionStorage.setItem(storageKey, result.token);
        update(result.view);
        setError("");
      }).catch(failure => {
        if (!live || current !== revision) return;
        if (failure instanceof RemoteError && ["practice-link", "qr-expired", "practice-seat-busy"].includes(failure.code)) clearCredential();
        setError(message(failure));
      }).finally(() => { if (live && current === revision) setJoining(false); });
    }
    function replaced(event: { reason: "reconnected" | "released" }) {
      revision++;
      clearCredential();
      setJoining(false);
      setError(role === "screen" ? "測試大螢幕已在另一個分頁開啟。" : event?.reason === "released"
        ? "此席已重新配對，請掃描大螢幕上 " + role + " 的最新 QR Code。"
        : "此席已在另一個分頁恢復連線。請使用該分頁的手掣。");
    }
    function scanAgain() {
      if (!readScan()) return;
      revision++;
      setError("");
      setJoining(true);
      if (socket.connected) restore();
      else if (!socket.active) socket.connect();
    }
    socket.on("connect", restore).on("practice:state", update).on("practice:replaced", replaced);
    window.addEventListener("hashchange", scanAgain);
    readScan();
    if (socket.connected) restore();
    else if (!token) setJoining(false);
    return () => {
      live = false;
      window.removeEventListener("hashchange", scanAgain);
      socket.off("connect", restore).off("practice:state", update).off("practice:replaced", replaced);
    };
  }, [update]);

  async function send(action: Action) {
    const current = active.current;
    if (current?.round?.status !== "running" || current.round.pausedAt != null || !current.screenOnline || !socket.connected) return;
    try { await request("practice:input", { sessionId: current.round.id, seq: ++seq.current, action }); }
    catch (failure) {
      if (failure instanceof RemoteError && ["not-running", "rate", "answer-cooldown", "host-offline"].includes(failure.code)) return;
      setError(message(failure));
    }
  }
  async function run(change: () => Promise<PracticeView>) {
    setBusy(true);
    setError("");
    try { update(await change()); } catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  }
  async function leave() {
    setBusy(true);
    sessionStorage.removeItem(storageKey);
    try { if (socket.connected) await request("practice:leave", null); }
    catch { socket.disconnect(); }
    finally { location.replace("/practice" + (role === "screen" ? "" : "?role=" + role)); }
  }

  if (!view) return <main id="main" className="narrow join-layout">
    <section className="panel join-panel" data-enter>
      <div className="feature-icon">{role === "screen" ? <Monitor size={28}/> : <GameController size={28}/>}</div>
      <h1>{role === "screen" ? "測試大螢幕" : practiceNames[role]}</h1>
      <p className="muted">{joining && !error ? "正在連線測試房" : role === "screen"
        ? "請從管理後台開啟測試大螢幕。" : "請掃描測試大螢幕上的 " + role + " QR Code。"}</p>
      <ErrorText text={error}/>
      {role === "screen" && <a className="button primary full" href="/admin">前往管理後台</a>}
    </section>
  </main>;

  const game = gameById.get(view.gameId)!;
  const round = view.round;
  const playing = round?.status === "running" || round?.status === "countdown";
  const screenLost = round?.status === "finished" && round.reason === "host-offline";
  const ready = view.screenOnline && practiceSeats.every(seat => view.seats[seat]);
  const controls = <div className="practice-controls">
    {!playing && <label className="field">選擇遊戲
      <select value={game.id} disabled={!online || busy} onChange={event => {
        const gameId = event.target.value;
        void run(() => request("practice:select", { gameId }));
      }}>{Object.entries(categoryLabel).map(([category, label]) => <optgroup label={label} key={category}>
        {GAMES.filter(item => item.category === category as Category).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </optgroup>)}</select>
    </label>}
    {!playing ? <button type="button" className="button primary" disabled={!ready || !online || busy}
      onClick={() => void run(() => request("practice:start", null))}>{round ? "再玩一局" : "開始測試"}</button>
      : <button type="button" className="button secondary" disabled={!online || busy}
        onClick={() => void run(() => request("practice:stop", null))}>結束這局</button>}
    {!ready && !playing && <p className="muted small">大螢幕和 P1、P2 都連線後即可開局。</p>}
  </div>;
  if (role !== "screen") {
    const side = practiceSeats.indexOf(role);
    return <main id="main" className="controller narrow">
      <section className="panel play-panel remote-panel" data-enter
        data-expression={game.controls === "expression" && round?.status === "running" ? "" : undefined}>
        <div className="play-heading"><div><p className="eyebrow">{practiceNames[role]}</p><h1>{game.name}</h1></div>
          {playing && <div className="play-clock"><RoomClock room={round} offset={offset}/></div>}</div>
        <div className="remote-player" data-side={side}><strong>{role} · {sideLabels[side]}</strong>
          <span><Monitor size={18}/> 看大螢幕操作</span></div>
        <ErrorText text={error}/>
        {!online && <p className="notice">正在重新連線</p>}
        {round?.pausedAt != null ? <ScreenPauseNotice at={round.pausedAt} offset={offset}/>
          : online && !view.screenOnline && !screenLost && <p className="notice">等待測試大螢幕連線</p>}
        {round?.status === "finished" && (round.reason === "host-offline"
          ? <p className="notice" role="status">大螢幕重連逾時，本局已取消。</p>
          : <RoundOutcome winner={round.winner} reason={round.reason} side={side}/>)}
        {online && view.screenOnline && round?.status === "running" && round.pausedAt == null &&
          <GameControls key={round.id} remote={view.remote ?? {}} controls={game.controls} gameId={game.id} offset={offset} send={send}/>}
        {controls}
      </section>
      <button type="button" className="text-button" onClick={() => void leave()} disabled={busy}>登出 {role}</button>
    </main>;
  }

  return <main id="main" className="host-display shell practice-display">
    <header className="host-top">
      <Brand/><div className="host-meta"><strong>測試大螢幕</strong><span>雙人練習</span></div>
      <div className="host-top-actions">
        <Status online={online} label={online ? "主機在線" : "正在重連"}/>
        <button className="icon-button" type="button" aria-label="切換全螢幕" onClick={() => {
          const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
          void action.catch(() => setError("瀏覽器目前無法切換全螢幕"));
        }}><ArrowsOut size={21}/></button>
        <button className="button compact secondary" type="button" onClick={() => void leave()} disabled={busy}>登出</button>
      </div>
    </header>
    <ErrorText text={error}/>
    <div className="host-layout">
      <section className="panel host-game" data-enter>
        <div className="host-title"><div><p className="eyebrow">1 對 1</p><h1>{game.name}</h1></div>
          <div className="host-clock"><RoomClock room={online ? round : null} offset={offset}/><span>{round?.status === "countdown" ? "開始倒數" : "剩餘時間"}</span></div>
        </div>
        {!online && playing && <p className="notice" role="status">大螢幕連線中斷，正在重連。</p>}
        {round?.status === "running" ? <ArenaPanels panels={view.panels ?? []} members={players}/>
          : round?.status === "countdown" ? <div className="host-stage countdown-center">
            <span>拿好手機，準備開局</span><RoomClock room={online ? round : null} offset={offset}/>
          </div>
          : round?.status === "finished" ? round.reason === "host-offline"
            ? <div className="host-stage idle"><h2>本局已取消</h2><p>大螢幕重連逾時。</p></div>
            : <RoundOutcome winner={round.winner} reason={round.reason} panels={view.panels}/>
          : <div className="host-stage idle practice-idle"><GameController size={68} weight="duotone"/>
            <h2>{ready ? "兩支手掣已連線" : "等待手機掃碼連線"}</h2><p>{game.objective}</p>
          </div>}
        {controls}
      </section>
      <aside className="host-aside" aria-label="手機入場">
        {practiceSeats.map((seat, side) => {
          const entry = view.entries?.find(item => item.seat === seat);
          return <section className="panel host-join practice-seat" data-side={side} key={seat}>
            <div className="section-line"><h2>{seat} · {practiceNames[seat]}</h2>
              <Status online={online && view.seats[seat]} label={!online ? "正在重連" : view.seats[seat] ? "已連線" : "等候掃碼"}/></div>
            {online && (view.seats[seat]
              ? <button className="button compact secondary" type="button" disabled={busy}
                onClick={() => void run(() => request("practice:release", { seat }))}>重新配對 {seat}</button>
              : <RotatingQr entry={entry} offset={offset} label={seat + " 測試登入"} newTab>
                <p className="muted small"><QrCode size={16}/> 用手機相機掃碼</p>
              </RotatingQr>)}
          </section>;
        })}
      </aside>
    </div>
  </main>;
}
