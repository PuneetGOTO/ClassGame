import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowLeft, Crosshair, GameController, Lightning, MapTrifold, Monitor, QrCode, SlidersHorizontal, Trophy, X
} from "@phosphor-icons/react";
import QRCode from "qrcode";
import { teamColors } from "../shared/catalog";
import type { DoubleChallenge, Progress, RoomView, StationView } from "../shared/protocol";
import { routePoints, type Difficulty } from "../shared/route";

export const fmtScore = (value: number) => new Intl.NumberFormat("zh-HK", { maximumFractionDigits: 2 }).format(value);
export const fmtChange = (value: number) => (value > 0 ? "+" : "") + fmtScore(value);
export const numberOf = (id: string) => id.slice(-2);
export const teamTone = (id: string) => teamColors[(Number(numberOf(id)) || 1) - 1] ?? teamColors[0];

const routes = [
  ["/", "校園地圖", MapTrifold],
  ["/leaderboard", "即時排行", Trophy],
  ["/controller", "手機控制器", GameController],
  ["/host", "大螢幕", Monitor],
  ["/admin", "管理後台", SlidersHorizontal]
] as const;
export function Brand() {
  return <a href="/" className="brand" aria-label="Campus Quest 校園地圖"><span className="brand-mark"><Crosshair weight="bold" size={21}/></span><span>Campus<span className="brand-accent">Quest</span></span></a>;
}
export function Header({ path, online }: { path: string; online: boolean }) {
  return <header className="topbar"><div className="nav-shell">
    <Brand/>
    <nav aria-label="主導覽">
      {routes.map(([href,label,Icon]) => <a key={href} href={href} aria-current={href === path ? "page" : undefined}>
        <Icon size={17} weight={path === href ? "fill" : "regular"}/><span>{label}</span>
      </a>)}
    </nav>
    <Status online={online} label={online ? "伺服器連線中" : "等待伺服器"}/>
  </div></header>;
}
export function Status({ online, label, active }: { online: boolean; label?: string; active?: boolean }) {
  return <span className={"status " + (active ? "status-active" : online ? "status-ready" : "status-offline")}>
    <i aria-hidden="true"/>{label ?? (online ? "在線" : "離線")}
  </span>;
}
export function stationStatus(station: StationView) {
  if (!station.open) return { online: false, label: "暫停入場" };
  if (!station.online) return { online: false, label: "主機離線" };
  if (station.activity) return { online: true, active: true, label: station.activity.status === "lobby" ? "候場中" : "遊戲中" };
  return { online: true, label: "可加入" };
}
export function StationStatus({ station }: { station: StationView }) { return <Status {...stationStatus(station)}/>; }
export function TeamTag({ id, name }: { id: string; name?: string }) {
  return <span className="team-tag" style={{ "--team-color": teamTone(id) } as CSSProperties}>
    <i aria-hidden="true"/>{name ?? "第 " + Number(numberOf(id)) + " 隊"}
  </span>;
}
export function HomeLink() { return <a className="quiet-link" href="/"><ArrowLeft size={17}/> 校園地圖</a>; }
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-mark"><Crosshair size={24}/></div><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
export function ErrorText({ text }: { text: string }) {
  return text ? <p className="notice error" role="alert">{text}</p> : null;
}
export function DoubleBanner({ challenge, playerId, team, tier = 1 }: { challenge: DoubleChallenge; playerId?: string; team: boolean; tier?: Difficulty }) {
  const isYou = challenge.playerId === playerId;
  const { win, loss } = routePoints(challenge.tier ?? tier);
  return <div className="double-banner" role="status" data-enter>
    <span className="double-symbol"><Lightning size={22} weight="fill"/></span>
    <div><strong>{isYou ? "你抽中了雙倍挑戰" : challenge.playerName + " 抽中雙倍挑戰"}</strong>
      <p>{team ? "按本關隊伍平均分計算。勝利加兩倍，失敗扣兩倍。" : "本場勝利 +" + win * 2 + " 分，失敗 −" + loss * 2 + " 分。"}</p></div>
    <b aria-hidden="true">×2</b>
  </div>;
}
export function Countdown({ end, offset, className = "", secondsOnly = false }: {
  end: number | null | undefined; offset: number; className?: string; secondsOnly?: boolean
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!end) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [end]);
  const seconds = end == null ? null : Math.max(0, Math.ceil((end - now - offset) / 1000));
  const text = seconds === null ? "—" : secondsOnly ? String(seconds) :
    [Math.floor(seconds / 60), seconds % 60].map(n => String(n).padStart(2, "0")).join(":");
  return <span className={"clock " + (seconds !== null && seconds <= 10 ? "clock-low " : "") + className}>{text}</span>;
}
export function RoomClock({ room, offset }: { room: Pick<RoomView, "status" | "startedAt" | "deadline"> | null | undefined; offset: number }) {
  return <Countdown end={room?.status === "countdown" ? room.startedAt : room?.status === "running" ? room.deadline : undefined}
    offset={offset} secondsOnly={room?.status === "countdown"}/>;
}
export function ProgressBar({ progress }: { progress: Progress }) {
  return <div className="progress">
    <div><span>{progress.label}</span><strong>{progress.value} / {progress.target}</strong></div>
    <progress value={progress.value} max={Math.max(1, progress.target)} aria-label={progress.label}/>
  </div>;
}
export function Qr({ url, label = "手機入場", newTab = false }: { url: string; label?: string; newTab?: boolean }) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { width: 260, margin: 3 }).then(data => { if (live) setQr(data); }).catch(() => {});
    return () => { live = false; };
  }, [url]);
  return <a className="qr-link" href={url} aria-label={"開啟" + label + "頁"} target={newTab ? "_blank" : undefined}
    rel={newTab ? "noreferrer" : undefined}>
    {qr ? <img src={qr} alt={label + " QR Code"} width="260" height="260"/> : <span className="qr-loading"><QrCode size={42}/></span>}
  </a>;
}
export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-head"><h2>{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label="關閉"><X size={20}/></button></div>
    {children}
  </dialog>;
}

