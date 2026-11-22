import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowCounterClockwise, CaretDoubleDown,
  Check, Crosshair, Eraser, Flag, Lightning
} from "@phosphor-icons/react";
import { teamColors, type Controls } from "../shared/catalog";
import type { Action, Direction, RemoteControls, RoomView, Scene } from "../shared/protocol";
import { fmtScore, Status } from "./components";

const directions: [Direction, string, typeof ArrowUp][] = [
  ["up", "向上", ArrowUp], ["left", "向左", ArrowLeft], ["down", "向下", ArrowDown], ["right", "向右", ArrowRight]
];
const tubeNames = ["青藍", "橙色", "薄荷", "玫瑰", "金色"];
const colorStyle = (tint?: number) => tint === undefined ? undefined : { "--piece-color": teamColors[tint % teamColors.length] } as CSSProperties;
const defaultTileNames: Record<string, string> = {
  wall: "牆壁", floor: "地板", player: "玩家", "player-done": "已抵達的玩家", goal: "目的地",
  box: "箱子", "box-done": "已歸位的箱子", crystal: "任務道具", exit: "出口", enemy: "守衛", dot: "豆子"
};

export const optionLetters = ["A", "B", "C", "D"] as const;

export function SceneView({ scene, cursor }: { scene: Scene; cursor?: number | null }) {
  if (scene.kind === "grid") return <div className="board" style={{ "--cols": scene.width, "--rows": scene.height } as CSSProperties} aria-label="遊戲棋盤">
    {scene.tiles.map((tile, index) => {
      const contents = <>
        {tile.mask !== undefined && <span className="pipe-arms" aria-hidden="true">
          {[0,1,2,3].map(direction => tile.mask! & (1 << direction) ? <i className={"arm arm-" + direction} key={direction}/> : null)}
          <i className="pipe-center"/>
        </span>}
        <span className="tile-label">{tile.label ?? (tile.kind === "player" ? "●" : tile.kind === "exit" ? <Flag size="65%" weight="fill"/> : "")}</span>
      </>;
      const className = "tile tile-" + tile.kind + (cursor === index ? " arena-cursor" : "");
      return <span key={index} className={className} style={colorStyle(tile.tint)} title={tile.title ?? defaultTileNames[tile.kind]}>{contents}</span>;
    })}
  </div>;
  if (scene.kind === "tubes") return <div className="tubes" aria-label="試管分色棋盤">
    {scene.tubes.map((tube, index) => {
      const inner = <><span className="glass">{tube.map((color, offset) =>
        <span className={"liquid liquid-" + color} key={offset}/>)}</span><span>{index + 1}</span></>;
      const className = "tube" + (index === scene.selected ? " tube-selected" : "") + (cursor === index ? " arena-cursor" : "");
      const title = "試管 " + (index + 1) + "，" + (tube.map(color => tubeNames[color]).join("、") || "空");
      return <div className={className} key={index} title={title}>{inner}</div>;
    })}
  </div>;
  if (scene.kind === "arcade") return <div className={"arcade theme-" + scene.theme} aria-label="即時遊戲畫面">
    {scene.rows && <div className="arcade-lanes" aria-hidden="true">{scene.rows.map((row, i) => <span key={i} className={"lane-" + row}/>)}</div>}
    {scene.actors.map((actor, index) => <span key={index} className={"actor actor-" + actor.kind} style={{
      ...colorStyle(actor.tint), left: actor.x + "%", top: actor.y + "%", width: actor.width + "%", height: actor.height + "%"
    }} aria-hidden="true"/>)}
  </div>;
  return <div className="quiz">
    {scene.brickTotal !== undefined && <div className="bricks" aria-label={"剩餘 " + scene.bricks + " 塊磚"}>
      {Array.from({ length: scene.brickTotal }, (_, i) => <span className={i >= scene.bricks! ? "broken" : ""} key={i}/>)}
    </div>}
    <div className="quiz-prompt">{scene.prompt?.text ?? "等待下一題"}</div>
    {scene.prompt?.numbers && <div className="number-cards">{scene.prompt.numbers.map((num, i) => <span key={i}>{num}</span>)}</div>}
    {scene.prompt?.options && <div className="arena-options">{scene.prompt.options.map((option, index) =>
      <div key={option.value}><b>{optionLetters[index]}</b><span>{option.label}</span></div>)}</div>}
    <div className="quiz-meta"><span>已答 <strong>{scene.attempted}</strong></span><span>答對 <strong>{scene.correct}</strong></span>
      {scene.feedback && <span className={scene.feedback === "correct" ? "good" : "bad"}>{scene.feedback === "correct" ? "答對" : "答錯"}</span>}
    </div>
  </div>;
}
function ActionButton({ action, send, children, label, className = "", repeat = false }: {
  action: Action; send: (action: Action) => void; children: ReactNode; label: string; className?: string; repeat?: boolean
}) {
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef({ action, send });
  current.current = { action, send };
  function release() {
    clearTimeout(hold.current);
    hold.current = undefined;
  }
  useEffect(() => {
    window.addEventListener("blur", release);
    return () => { window.removeEventListener("blur", release); release(); };
  }, []);
  function pulse() {
    current.current.send(current.current.action);
    hold.current = setTimeout(pulse, 110);
  }
  return <button type="button" className={"control " + className} aria-label={label}
    onClick={event => { if (!repeat || event.detail === 0) send(action); }}
    onPointerDown={event => {
      if (!repeat || event.button !== 0) return;
      release();
      event.currentTarget.setPointerCapture(event.pointerId);
      send(action);
      hold.current = setTimeout(pulse, 240);
    }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onContextMenu={event => { if (repeat) event.preventDefault(); }}
  >{children}</button>;
}

function QuizControls({ remote, isExpression, send }: { remote: RemoteControls; isExpression: boolean; send: (action: Action) => void }) {
  const [value, setValue] = useState("");
  const questionId = remote.questionId;
  if (questionId === undefined) return <p className="muted">本方已完成題組，等候本場結果。</p>;
  const submit = () => {
    if (!value.trim()) return;
    send({ kind: "answer", questionId, value: value.trim() });
    setValue("");
  };
  if (remote.choices) return <div className="options remote-choices" aria-label="答題按鍵">
    {optionLetters.slice(0, remote.choices).map((letter, index) => <button type="button" className="control" key={letter}
      onClick={() => send({ kind: "choice", questionId, index })}>{letter}</button>)}
  </div>;
  const keys = ["1","2","3","4","5","6","7","8","9","0"];
  const append = (key: string) => setValue(previous => (previous + key).slice(0, 64));
  return <form className="answer-form" onSubmit={event => { event.preventDefault(); submit(); }}>
    <label htmlFor="answer">{isExpression ? "輸入算式" : "輸入答案"}</label>
    <input id="answer" inputMode={isExpression ? "text" : "numeric"} value={value} maxLength={64}
      autoComplete="off" onChange={event => setValue(event.target.value)} placeholder={isExpression ? "把四個數字各用一次" : "答案"}/>
    {isExpression && <div className="expression-keys">{["+","−","×","÷","(",")"].map(operator =>
      <button className="control" type="button" key={operator} onClick={() => append(operator)}>{operator}</button>)}</div>}
    <div className="keypad">
      {keys.map(key => <button type="button" className="control" key={key} onClick={() => append(key)}>{key}</button>)}
      <button type="button" className="control" aria-label="刪除" onClick={() => setValue(value.slice(0, -1))}><Eraser size={20}/></button>
      <button type="button" className="control" onClick={() => setValue("")}>清除</button>
    </div>
    <button type="submit" className="button primary full" disabled={!value.trim()}>確認答案</button>
  </form>;
}

export function GameControls({ remote, controls, gameId, send }: {
  remote: RemoteControls; controls: Controls; gameId: string; send: (action: Action) => void
}) {
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes((event.target as HTMLElement).tagName)) return;
      const direction = directions.find(([name]) => event.key.toLowerCase() === "arrow" + name)?.[0];
      if (direction && ["directions", "traffic", "quest", "flight", "cell"].includes(controls)) {
        event.preventDefault();
        sendRef.current({ kind: controls === "cell" ? "cursor" : "move", direction });
      } else if (event.code === "Space" && ["flight", "runner", "quest", "cell", "traffic"].includes(controls)) {
        event.preventDefault();
        sendRef.current({ kind: "action", action: controls === "flight" ? "shoot" : controls === "runner" ? "jump" : "interact" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [controls]);
  if (controls === "answer" || controls === "expression") {
    return <QuizControls key={remote.questionId ?? 0} remote={remote} isExpression={controls === "expression"} send={send}/>;
  }
  if (controls === "flight" || controls === "runner") return <div className="action-controls">
    {controls === "flight" ? <>
      <ActionButton repeat send={send} action={{ kind: "move", direction: "left" }} label="向左"><ArrowLeft size={28}/></ActionButton>
      <ActionButton repeat send={send} action={{ kind: "action", action: "shoot" }} label="發射" className="control-primary"><Crosshair size={24}/> 發射</ActionButton>
      <ActionButton repeat send={send} action={{ kind: "move", direction: "right" }} label="向右"><ArrowRight size={28}/></ActionButton>
    </> : <>
      <ActionButton send={send} action={{ kind: "action", action: "duck" }} label="蹲下"><CaretDoubleDown size={24}/> 蹲下</ActionButton>
      <ActionButton send={send} action={{ kind: "action", action: "jump" }} label="跳躍" className="control-primary"><ArrowUp size={24}/> 跳躍</ActionButton>
    </>}
  </div>;
  return <div className="direction-controls">
    <div className="dpad" aria-label="方向鍵">
      {directions.map(([direction, label, Icon]) => <ActionButton repeat key={direction} className={"move-" + direction}
        send={send} action={{ kind: controls === "cell" ? "cursor" : "move", direction }} label={label}><Icon size={28} weight="bold"/></ActionButton>)}
    </div>
    {controls === "quest" && <ActionButton send={send} action={{ kind: "action", action: "interact" }} label="互動"><Lightning size={20}/> 互動</ActionButton>}
    {controls === "cell" && <ActionButton send={send} action={{ kind: "action", action: "interact" }} label="確認" className="control-primary">
      <Check size={22}/> 確認</ActionButton>}
    {controls === "traffic" && <div className="traffic-controls">
      <ActionButton send={send} action={{ kind: "cursor", direction: "left" }} label="上一輛車"><ArrowLeft size={20}/> 上一輛</ActionButton>
      <ActionButton send={send} action={{ kind: "cursor", direction: "right" }} label="下一輛車">下一輛 <ArrowRight size={20}/></ActionButton>
      <ActionButton send={send} action={{ kind: "action", action: "interact" }} label="選取車輛" className="control-primary"><Check size={22}/> 選車</ActionButton>
    </div>}
    {gameId === "game-01" && <ActionButton send={send} action={{ kind: "action", action: "interact" }} label="重排箱子">
      <ArrowCounterClockwise size={20}/> 重排箱子</ActionButton>}
  </div>;
}

export function Members({ room, self }: { room: RoomView; self?: string }) {
  return <div className="members">
    {room.members.map(member => <div className="member" key={member.id}>
      <span className="member-avatar" style={colorStyle(member.tint)}>P{member.position}</span>
      <span className="member-name">{member.name}{member.id === self ? "（你）" : ""}</span>
      {member.progress && <span className="monotext">{fmtScore(member.progress.value)}/{member.progress.target}</span>}
      <Status online={member.connected && !member.forfeited} label={member.forfeited ? "已退出" : !member.connected ? "離線"
        : !member.checkedIn ? "尚未到場" : member.ready ? "已就緒" : "準備中"}/>
    </div>)}
  </div>;
}

