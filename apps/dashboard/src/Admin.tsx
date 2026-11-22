import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowsLeftRight, ArrowRight, ClipboardText, Copy, DownloadSimple, Flag, GameController, GearSix, Key, Lightning, LinkSimple,
  ListChecks, MapPin, PencilSimple, Plug, Plus, ShieldCheck, Trash, Trophy, UsersThree
} from "@phosphor-icons/react";
import { gameById, PLAYER_LIMIT, TEAM_SIZE } from "../../../packages/shared/catalog";
import { floorLabel, FLOORS, type Floor } from "../../../packages/shared/floors";
import { nameSchema, studentNumberSchema, type AdminState, type Result, type StationView, type StudentCredential, type TeamResult } from "../../../packages/shared/protocol";
import { ROUTE_LENGTH } from "../../../packages/shared/route";
import { Dialog, Empty, ErrorText, fmtChange, fmtScore, numberOf, StationStatus, Status, TeamTag } from "../../../packages/ui/components";
import { KawaiiGingerbread, KawaiiSnowman } from "../../../packages/ui/christmas-art";
import { FloorChooser, FloorGraphic } from "../../../packages/ui/floor-map";
import { adminRequest, message, RemoteError, request, socket, type CampusConnection } from "../../../packages/ui/network";
import { AdminLeaderboard, type ScoreScope } from "./AdminLeaderboard";

const keyStorage = "campus.adminKey";
const formatTime = (value: number) => new Intl.DateTimeFormat("zh-HK", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
}).format(value);
const actionLabels: Record<string,string> = {
  start: "啟動倒數", stop: "停止本場", reset: "作廢本場", "clear-queue": "取消候場"
};
const reasons: Record<string,string> = {
  goal: "達成任務", completed: "題組完成", timeout: "時間到", stopped: "管理員停止", forfeit: "退出", reset: "已重設",
  "lobby-expired": "候場逾時", "no-play": "未有兩方操作", "host-offline": "大螢幕離線", error: "遊戲錯誤"
};
const auditNames: Record<string,string> = {
  "player.create": "新增玩家", "player.rename": "更名", "player.kick": "踢除玩家", "player.link": "重發入場連結",
  "player.identity": "更新學號", "player.code": "重發登入碼", "player.suspend": "停用帳號", "player.reactivate": "重新啟用帳號",
  "settings.registration": "變更暱稱登記",
  "team.change": "變更隊伍", "team.auto": "自動分隊", "map.update": "更新地圖",
  "station.configure": "更新站點", "station.start": "開始場次", "station.stop": "停止場次",
  "station.reset": "作廢場次", "station.retry": "開放重玩", "station.clear-queue": "清空隊列",
  "session.void": "撤銷場次成績",
  "round.open": "新增正式輪次", "competition.reset": "重設比賽", "system.error": "系統錯誤", "rules.update": "更新雙倍挑戰"
};
type AdminPlayer = AdminState["players"][number];
type Session = AdminState["sessions"][number];
type Confirm = { title: string; detail: string; run: () => Promise<void> };
type Run = (fn: () => Promise<void>, success?: string) => Promise<void>;

export function Admin({ connection }: { connection: CampusConnection }) {
  const campus = connection.state;
  const [secret, setSecret] = useState(() => sessionStorage.getItem(keyStorage) || "");
  const [entry, setEntry] = useState(secret);
  const [admin, setAdmin] = useState<AdminState | null>(null);
  const [section, setSection] = useState<"stations" | "players" | "leaderboard" | "sessions" | "system">("stations");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>();
  const [practiceLink, setPracticeLink] = useState("");

  useEffect(() => {
    if (!secret) return;
    let live = true;
    function restore() {
      void request("admin:watch", { key: secret }).then(value => { if (live) setAdmin(value); }).catch(failure => {
        if (live && failure instanceof RemoteError && failure.code === "unauthorized") {
          sessionStorage.removeItem(keyStorage);
          setAdmin(null);
          setSecret("");
          setError(message(failure));
        }
      });
    }
    socket.on("connect", restore).on("admin:status", setAdmin);
    if (socket.connected) restore();
    void adminRequest<AdminState>(secret,"/state").then(value => { if (live) setAdmin(value); }).catch(failure => {
      if (live) {
        setError(message(failure));
        if (failure instanceof RemoteError && failure.code === "unauthorized") {
          sessionStorage.removeItem(keyStorage);
          setSecret("");
        }
      }
    });
    return () => { live = false; socket.off("connect", restore).off("admin:status", setAdmin); };
  }, [secret]);

  const run: Run = useCallback(async (fn, feedback) => {
    setBusy(true); setError(""); setSuccess("");
    try { await fn(); if (feedback) setSuccess(feedback); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }, []);
  function login(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const session = await adminRequest<AdminState>(entry.trim(),"/state");
      setSecret(entry.trim());
      sessionStorage.setItem(keyStorage,entry.trim());
      setAdmin(session);
    });
  }
  if (!admin) return <main id="main" className="narrow join-layout" data-enter><section className="panel join-panel">
    <div className="xmas-login-mascots">
      <KawaiiGingerbread size={50}/>
      <p>校園聖誕闖關</p>
      <KawaiiSnowman size={50}/>
    </div>
    <div className="feature-icon"><ShieldCheck size={30} weight="duotone"/></div>
    <p className="eyebrow">活動管理員</p><h1>登入管理後台</h1>
    <p className="muted">輸入中央伺服器的管理金鑰。</p>
    <form className="form-stack" onSubmit={login}>
      <label>管理金鑰<input type="password" value={entry} onChange={event => setEntry(event.target.value)} required
        autoComplete="current-password" placeholder="輸入管理金鑰"/></label>
      <ErrorText text={error}/>
      <button className="button primary full" type="submit" disabled={!entry.trim() || busy}>開啟管理後台 <ArrowRight size={18}/></button>
    </form>
  </section></main>;

  async function exportCsv(scope: ScoreScope = "players", competitionId?: number) {
    await run(async () => {
      const params = new URLSearchParams({ scope });
      if (competitionId !== undefined) params.set("competition", String(competitionId));
      const response = await fetch("/api/admin/scores.csv?" + params, { headers: { Authorization: "Bearer " + secret } });
      if (!response.ok) throw new Error("成績匯出失敗，請確認管理連線");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /\bfilename=(?:"([^"]+)"|([^;\s]+))/i.exec(disposition);
      link.download = filename?.[1] ?? filename?.[2]
        ?? (scope === "teams" ? "campus-teams.csv" : "campus-scores.csv");
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  }
  const ask = (value: Confirm) => { setError(""); setConfirm(value); };
  const logOut = () => {
    sessionStorage.removeItem(keyStorage);
    location.reload();
  };
  return <main id="main" className="shell dashboard admin-page">
    <div className="page-intro" data-enter><div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <KawaiiGingerbread size={62}/>
      <div><p className="eyebrow"><ShieldCheck size={18}/> 第 {admin.competitionId} 屆正式比賽</p>
      <h1>管理後台</h1><p className="muted">管理站點排程、隊伍名單及正式成績。</p></div></div>
      <div className="admin-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={() => void run(async () => {
          const { screenKey } = await adminRequest<{ screenKey: string }>(secret, "/practice");
          setPracticeLink("/practice#" + new URLSearchParams({ key: screenKey }));
        })}><GameController size={18}/> 測試遊戲</button>
        <button className="button secondary" onClick={logOut}>登出</button>
        <button className="button primary" type="button" disabled={busy} onClick={() => void exportCsv()}><DownloadSimple size={18}/> 匯出 CSV</button></div>
    </div>
    <div className="segmented admin-tabs">
      {([
        ["stations","站點管理",MapPin],["players","玩家與隊伍",UsersThree],["leaderboard","排行榜管理",Trophy],["sessions","場次紀錄",ListChecks],
        ["system","規則與稽核",Plug]
      ] as const).map(([id,label,Icon]) => <button key={id} aria-pressed={section === id} onClick={() => { setSection(id); setError(""); setSuccess(""); }}>
        <Icon size={18}/>{label}</button>)}
    </div>
    <ErrorText text={error}/>
    {success && <p className="notice success" role="status">{success}</p>}
    {section === "stations" && <AdminStations connection={connection} adminKey={secret} busy={busy} run={run} ask={ask}/>}
    {section === "players" && <AdminPlayers admin={admin} connection={connection} adminKey={secret} busy={busy} error={error}
      run={run} ask={ask} clearError={() => setError("")} exportTeams={() => void exportCsv("teams")}/>}
    {section === "leaderboard" && <AdminLeaderboard admin={admin} live={campus?.competitionId === admin.competitionId ? campus.leaderboard : undefined}
      adminKey={secret} busy={busy} error={error} run={run} exportCsv={(scope, competitionId) => void exportCsv(scope, competitionId)}/>}
    {section === "sessions" && <AdminSessions admin={admin} adminKey={secret} run={run} busy={busy}/>}
    {section === "system" && <div className="admin-columns">
      {campus && <DoubleRules key={campus.doubleChance} chance={campus.doubleChance} adminKey={secret} run={run} busy={busy}/>}
      <section className="panel admin-panel"><h2><Plug size={22}/> WebSocket 連線</h2>
        <dl className="station-values admin-system">
          <div><dt>目前瀏覽器</dt><dd><Status online={connection.online}/></dd></div>
          <div><dt>WebSocket 連線</dt><dd>{admin.connections.sockets}</dd></div>
          <div><dt>玩家</dt><dd>{admin.connections.players} / 50</dd></div>
          <div><dt>主機</dt><dd>{admin.connections.hosts} / 20</dd></div>
          <div><dt>本次啟動的伺服器錯誤</dt><dd>{admin.connections.errors}</dd></div>
        </dl>
      </section>
      <section className="panel admin-panel admin-wide"><h2><ClipboardText size={22}/> 操作稽核</h2>
        {!admin.audit.length ? <Empty title="目前沒有管理紀錄"/> : <div className="table-scroll"><table>
          <thead><tr><th>時間</th><th>操作</th><th>項目</th></tr></thead>
          <tbody>{admin.audit.map((entry,i) => <tr key={entry.date + "-" + i}><td>{formatTime(entry.date)}</td>
            <td>{auditNames[entry.action] ?? entry.action}</td><td className="break-cell">{entry.detail}</td></tr>)}</tbody>
        </table></div>}
      </section>
    </div>}
    {practiceLink && <Dialog title="測試遊戲" onClose={() => setPracticeLink("")}>
      <p className="muted">在這台電腦開啟大螢幕，再用兩支手機分別掃描 P1、P2。</p>
      <div className="admin-actions dialog-actions">
        <a className="button primary" href={practiceLink} target="_blank" rel="noreferrer" onClick={() => setPracticeLink("")}>
          開啟測試大螢幕 <ArrowRight size={18}/>
        </a>
      </div>
    </Dialog>}
    {confirm && <Dialog title={confirm.title} onClose={() => setConfirm(undefined)}>
      <p className="muted">{confirm.detail}</p>
      <form className="form-stack" onSubmit={event => {
        event.preventDefault();
        setConfirm(undefined);
        void run(confirm.run,"操作完成");
      }}>
        <button className="button danger full" disabled={busy} type="submit">確認{confirm.title}</button>
      </form>
    </Dialog>}
    {!campus && <p className="notice">等候校園狀態同步</p>}
  </main>;
}

function AdminStations({ connection, adminKey, busy, run, ask }: {
  connection: CampusConnection; adminKey: string; busy: boolean; run: Run; ask: (value: Confirm) => void
}) {
  const campus = connection.state;
  const [floor, setFloor] = useState<Floor>(3);
  const [id,setId] = useState<string>();
  const stationList = campus?.stations.filter(entry => entry.floor === floor) ?? [];
  const station = stationList.find(entry => entry.id === id) ?? stationList[0];
  const [hostCredentials, setHostCredentials] = useState<{ id: string; key: string }>();
  const [showMap, setShowMap] = useState(false);
  return <div className="admin-columns station-admin">
    <section className="panel admin-panel">
      <div className="section-line"><h2><MapPin size={22}/> 固定遊戲站點</h2><button className="button compact secondary" onClick={() => setShowMap(true)}>更換{floorLabel[floor]}地圖</button></div>
      <FloorChooser floor={floor} select={setFloor} stations={campus?.stations}/>
      {stationList.length ? <div className="admin-station-list">{stationList.map(item => <button key={item.id}
        className="admin-station" type="button" aria-pressed={station?.id === item.id} onClick={() => setId(item.id)}>
        <span className="admin-station-num">{numberOf(item.id)}</span><span><strong>{item.name}</strong>
          <small>{gameById.get(item.gameId)?.name} · {item.hostId}</small></span><StationStatus station={item}/>
      </button>)}</div> : <Empty title={campus ? "此樓層暫無站點" : "載入站點"}/>}
    </section>
    {station && <StationForm key={[station.id,station.name,station.floor,station.x,station.y,station.hostId,station.gameId,station.open].join("|")}
      station={station} connection={connection} adminKey={adminKey} busy={busy} run={run} ask={ask}
      onKey={link => setHostCredentials(link)}/>}
    {hostCredentials && <Dialog title={hostCredentials.id + " 主機金鑰"} onClose={() => setHostCredentials(undefined)}>
      <label className="field">專屬金鑰<input readOnly value={hostCredentials.key} onFocus={event => event.target.select()}/></label>
      <div className="admin-actions dialog-actions"><button className="button secondary" onClick={() => void run(() => copyText(hostCredentials.key),"已複製金鑰")}><Copy size={17}/> 複製金鑰</button>
        <a className="button primary" href={"/host?id=" + hostCredentials.id} target="_blank" rel="noreferrer">開啟主機頁 <ArrowRight size={16}/></a></div>
    </Dialog>}
    {showMap && <Dialog title={"更換" + floorLabel[floor] + "地圖"} onClose={() => setShowMap(false)}><MapUpload
      busy={busy} onSave={image => void run(async () => {
        await adminRequest(adminKey,"/map/" + floor,"PUT",{ image });
        setShowMap(false);
      },"地圖已更新")}/></Dialog>}
  </div>;
}

function StationForm({ station, connection, adminKey, busy, run, ask, onKey }: {
  station: StationView; connection: CampusConnection; adminKey: string; busy: boolean; run: Run; ask: (value: Confirm) => void;
  onKey: (credentials: { id: string; key: string }) => void
}) {
  const [name,setName] = useState(station.name);
  const [floor, setFloor] = useState(station.floor);
  const [x,setX] = useState(String(station.x));
  const [y,setY] = useState(String(station.y));
  const [hostId,setHostId] = useState(station.hostId);
  const [open,setOpen] = useState(station.open);
  const post = (action: keyof typeof actionLabels) => async () => {
    await adminRequest(adminKey,"/stations/" + station.id + "/action","POST",{ action });
  };
  return <section className="panel admin-panel">
    <div className="section-line"><h2><GearSix size={22}/> {station.name}</h2></div>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        await adminRequest(adminKey,"/stations/" + station.id,"PATCH",{ name, floor, x: Number(x), y: Number(y), hostId, gameId: station.gameId, open });
      },"站點設定已儲存");
    }}>
      <div className="form-columns">
        <label>站點名稱<input value={name} required maxLength={24} onChange={event => setName(event.target.value)}/></label>
        <label>樓層<select value={floor} onChange={event => setFloor(event.target.value === "4" ? 4 : 3)}>
          {FLOORS.map(level => <option key={level} value={level}>{floorLabel[level]}</option>)}
        </select></label>
      </div>
      <div className="form-columns">
        <label>房間固定遊戲<input value={gameById.get(station.gameId)?.name ?? station.gameId} readOnly/></label>
        <label>指定主機<select value={hostId} onChange={event => setHostId(event.target.value)}>
          {connection.state?.stations.slice().sort((a,b) => a.hostId.localeCompare(b.hostId)).map(entry =>
            <option key={entry.hostId} value={entry.hostId}>{entry.hostId}</option>)}
        </select></label>
      </div>
      <fieldset className="location-field"><legend>站點座標</legend>
        <button type="button" className="coordinate-map" aria-label="點按地圖設定站點座標"
          onClick={event => {
            if (event.detail === 0) return;
            const box = event.currentTarget.getBoundingClientRect();
            setX(((event.clientX - box.left) / box.width * 100).toFixed(1));
            setY(((event.clientY - box.top) / box.height * 100).toFixed(1));
          }}>
          <FloorGraphic key={floor} floor={floor} override={connection.state?.floorMaps[floor]}/><span className="map-marker selected"
            style={{ left: x + "%", top: y + "%" }}>{numberOf(station.id)}</span>
        </button>
        <div className="form-columns"><label>水平百分比<input type="number" min="0" max="100" step="0.1" value={x} required
          onChange={event => setX(event.target.value)}/></label>
          <label>垂直百分比<input type="number" min="0" max="100" step="0.1" value={y} required
            onChange={event => setY(event.target.value)}/></label></div>
      </fieldset>
      <label className="check-field"><input type="checkbox" checked={open} onChange={event => setOpen(event.target.checked)}/> 開放入場</label>
      <div className="admin-actions">
        <button className="button primary" type="submit" disabled={busy}>儲存站點設定</button>
        <button className="button secondary" type="button" disabled={busy} onClick={() => void run(async () => {
          const data = await adminRequest<{ key: string }>(adminKey,"/hosts/" + station.hostId + "/key");
          onKey({ id: station.hostId, key: data.key });
        })}><Key size={17}/> 查看主機金鑰</button>
      </div>
    </form>
    <div className="admin-room-actions">
      <h3>場次操作</h3><p className="muted">{station.activity ? "參賽者 " + station.activity.names.join("、") : "目前沒有場次"} · {station.queued} 人未報到</p>
      <div className="admin-actions">
        <button className="button compact secondary" disabled={busy || station.activity?.status !== "lobby" || !station.open} onClick={() => ask({
          title: actionLabels.start, detail: "至少兩位在線玩家掃碼並就緒後可開始 3 秒倒數。", run: post("start")
        })}>{actionLabels.start}</button>
        {([
          ["stop","停止目前場次，玩家可重新配對。"],
          ["reset","作廢目前場次並保留紀錄，玩家可重新配對。"],
          ["clear-queue","取消本站尚未開打的配對。"]
        ] as const).map(([id, detail]) => <button key={id} className="button compact secondary" disabled={busy ||
          (["stop","reset"].includes(id) && !station.activity) || (id === "clear-queue" && station.activity?.status !== "lobby")}
          onClick={() => ask({ title: actionLabels[id], detail, run: post(id) })}>{actionLabels[id]}</button>)}
      </div>
    </div>
  </section>;
}

function MapUpload({ busy, onSave }: { busy: boolean; onSave: (image: string | null) => void }) {
  const [value,setValue] = useState<string>();
  const [error,setError] = useState("");
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); if (value) onSave(value); }}>
    <p className="muted">上傳 PNG、JPEG 或 WebP。上限 1.5 MB。座標以圖片寬高的百分比定位。</p>
    <label>地圖圖片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
      const file = event.target.files?.[0];
      setValue(undefined); setError("");
      if (!file) return;
      if (file.size > 1_500_000) { setError("圖片超過 1.5 MB"); return; }
      const reader = new FileReader();
      reader.onload = () => setValue(String(reader.result));
      reader.onerror = () => setError("無法讀取圖片，請再試一次");
      reader.readAsDataURL(file);
    }}/></label>
    {value && <img className="map-preview" src={value} alt="新校園地圖預覽"/>}
    <ErrorText text={error}/>
    <div className="admin-actions"><button className="button primary" type="submit" disabled={!value || busy}>儲存圖片</button>
      <button className="button secondary" type="button" disabled={busy} onClick={() => onSave(null)}>恢復內建樓層圖</button></div>
  </form>;
}
function DoubleRules({ chance, adminKey, run, busy }: { chance: number; adminKey: string; run: Run; busy: boolean }) {
  const [value, setValue] = useState(String(chance));
  return <section className="panel admin-panel">
    <h2><Lightning size={22}/> 雙倍挑戰</h2>
    <p className="muted">新場次開始時抽籤。抽中的場次會在比賽中或提前結算時公布一位在線玩家。勝利加兩倍，失敗扣兩倍。設為 0% 可關閉。</p>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        await adminRequest(adminKey,"/rules","PUT",{ doubleChance: Number(value) });
      },"雙倍挑戰機率已更新");
    }}>
      <label>每場觸發機率 (%)<input type="number" min="0" max="100" step="1" required value={value}
        onChange={event => setValue(event.target.value)}/></label>
      <button className="button primary" type="submit" disabled={busy || !value || Number(value) === chance}>儲存遊戲規則</button>
    </form>
  </section>;
}

function AdminPlayers({ admin, connection, adminKey, busy, error, run, ask, clearError, exportTeams }: {
  admin: AdminState; connection: CampusConnection; adminKey: string; busy: boolean; error: string; run: Run; ask: (value: Confirm) => void;
  clearError: () => void; exportTeams: () => void;
}) {
  const [editing, setEditing] = useState<AdminPlayer>();
  const [showCreate,setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [search,setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [joinLink,setJoinLink] = useState("");
  const [credentials, setCredentials] = useState<StudentCredential[]>([]);
  const [results,setResults] = useState<{ name: string; items: Result[] }>();
  const teams = connection.state?.leaderboard.teams.slice().sort((a,b) => a.id.localeCompare(b.id)) ?? [];
  const available = PLAYER_LIMIT - admin.players.length;
  const query = search.normalize("NFKC").trim().toLowerCase();
  const matchingPlayers = admin.players.filter(player => {
    if ((filter === "linked" && !player.studentNumber) || (filter === "unlinked" && player.studentNumber) ||
      (filter === "suspended" && !player.suspended)) return false;
    return [player.name, player.studentNumber, player.teamId].some(value => value?.normalize("NFKC").toLowerCase().includes(query));
  });
  async function showLink(token: string) {
    const response = await fetch("/api/entry?origin=" + encodeURIComponent(location.origin));
    const info = response.ok ? await response.json() : { url: new URL("/controller",location.href).href };
    setJoinLink(info.url + "#join=" + encodeURIComponent(token));
  }
  const actions = (player: AdminPlayer) => [
    [PencilSimple,"編輯玩家", () => { clearError(); setEditing(player); }],
    [ListChecks,"查看玩家成績", () => void run(async () => setResults({ name: player.name, items:
      await adminRequest<Result[]>(adminKey,"/players/" + player.id + "/results") }))],
    [player.studentNumber ? Key : LinkSimple, player.studentNumber ? "重發登入碼" : "重發入場連結", () => {
      const title = player.studentNumber ? "重發登入碼" : "重發入場連結";
      ask({ title, detail: "重發後，" + player.name + " 的舊登入憑證會失效，手機會登出。", run: async () => {
        if (player.studentNumber) setCredentials([await adminRequest<StudentCredential>(adminKey,"/players/" + player.id + "/code","POST")]);
        else {
          const { token } = await adminRequest<{ token: string }>(adminKey,"/players/" + player.id + "/link","POST");
          await showLink(token);
        }
      } });
    }],
    [ShieldCheck, player.suspended ? "重新啟用帳號" : "停用帳號", () => ask({
      title: player.suspended ? "重新啟用帳號" : "停用帳號",
      detail: player.suspended ? "恢復 " + player.name + " 的入場資格。"
        : "停用 " + player.name + " 的登入，並中止目前手機連線及配對。成績和帳號資料會保留。",
      run: async () => { await adminRequest(adminKey,"/players/" + player.id + "/status","PUT",{ suspended: !player.suspended }); }
    })],
    [Trash,"踢除手機連線", () => ask({ title: "踢除手機連線", detail: "中止 " + player.name + " 的手機連線並停用舊入場連結。",
      run: async () => { await adminRequest(adminKey,"/players/" + player.id + "/kick","POST"); } })]
  ] as const;
  return <div className="admin-columns player-admin">
    <section className="panel admin-panel">
      <div className="section-line"><h2><UsersThree size={22}/> 玩家 {admin.players.length} / {PLAYER_LIMIT}</h2>
        <div className="admin-actions"><button className="button compact secondary" disabled={busy} onClick={() => ask({
          title: "自動分隊", detail: "依玩家登記順序重新編成 10 隊，每隊最多 5 人。",
          run: async () => { await adminRequest(adminKey,"/teams/auto","POST"); }
        })}>自動分隊</button><button className="button compact secondary" disabled={busy || !available}
          onClick={() => { clearError(); setShowImport(true); }}>批量新增</button>
          <button className="button compact primary" disabled={busy || !available}
            onClick={() => { clearError(); setShowCreate(true); }}><Plus size={16}/> 新增玩家</button></div></div>
      <div className="account-filters">
        <input type="search" aria-label="搜尋玩家" placeholder="搜尋姓名、學號或隊伍" value={search} onChange={event => setSearch(event.target.value)}/>
        <select aria-label="篩選帳號狀態" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">所有帳號</option><option value="linked">已綁定學號</option>
          <option value="unlinked">待綁定學號</option><option value="suspended">已停用</option>
        </select>
      </div>
      {!matchingPlayers.length ? <Empty title={admin.players.length ? "找不到符合的玩家" : "尚未有玩家"}/> : <div className="table-scroll"><table>
        <thead><tr><th>名稱</th><th>學號</th><th>隊伍</th><th>狀態</th><th>所在站點</th><th>進度</th><th>總分</th><th>操作</th></tr></thead>
        <tbody>{matchingPlayers.map(player => <tr key={player.id}>
          <th scope="row">{player.name}</th><td className="student-number">{player.studentNumber ?? "—"}</td>
          <td><TeamTag id={player.teamId}/></td><td><Status online={player.connected && !player.suspended}
            label={player.suspended ? "已停用" : player.needsLink ? "連結已停用" : undefined}/></td>
          <td>{player.stationId ? connection.state?.stations.find(item => item.id === player.stationId)?.name ?? player.stationId : "—"}</td>
          <td>{Math.min(connection.state?.leaderboard.players.find(item => item.id === player.id)?.completed ?? 0, ROUTE_LENGTH)} / {ROUTE_LENGTH}</td>
          <td className="em-score">{fmtScore(player.totalScore)}</td><td><div className="player-actions">
            {actions(player).map(([Icon,label,fn]) => <button key={label} className="icon-button" type="button" disabled={busy}
              onClick={fn} aria-label={label + " " + player.name + (player.studentNumber ? " " + player.studentNumber : "")}
              title={label}><Icon size={17}/></button>)}</div></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    <div className="account-sidebar">
      <section className="panel admin-panel">
        <h2>入場設定</h2>
        <p className="muted">{admin.selfRegistration ? "開放以暱稱自行登記。" : "玩家可使用學號登入或管理員發出的入場連結。"}</p>
        <button type="button" className="button secondary" disabled={busy} onClick={() => {
          const open = !admin.selfRegistration;
          void run(async () => { await adminRequest(adminKey, "/registration", "PUT", { open }); }, open ? "已開放暱稱登記" : "已關閉暱稱登記");
        }}>{admin.selfRegistration ? "關閉暱稱登記" : "開放暱稱登記"}</button>
      </section>
      <section className="panel admin-panel"><div className="section-line"><h2>隊伍名單</h2>
        <button className="button compact secondary" type="button" disabled={busy} onClick={exportTeams}><DownloadSimple size={15}/> 隊伍 CSV</button>
        </div><div className="admin-rosters">
        {teams.map(team => <div key={team.id}><TeamTag id={team.id} name={team.name}/><span>{team.members.length}/{TEAM_SIZE} 人</span>
          <p>{team.members.length ? team.members.map(player => player.name).join("、") : "等候隊員"}</p></div>)}
      </div></section>
    </div>
    {showCreate && <Dialog title="新增玩家" onClose={() => setShowCreate(false)}>
      <PlayerCreate teams={teams} busy={busy} error={error} onCreate={body => void run(async () => {
        const result = await adminRequest<StudentCredential | { token: string }>(adminKey,"/players","POST",body);
        setShowCreate(false);
        if ("code" in result) setCredentials([result]);
        else await showLink(result.token);
      },"玩家已新增")}/>
    </Dialog>}
    {showImport && <Dialog title="批量新增學生" onClose={() => setShowImport(false)}>
      <StudentImport available={available} busy={busy} error={error} onImport={students => void run(async () => {
        setCredentials(await adminRequest<StudentCredential[]>(adminKey, "/players/import", "POST", { students }));
        setShowImport(false);
      },"學生帳號已新增")}/>
    </Dialog>}
    {editing && <Dialog title={"編輯 " + editing.name} onClose={() => setEditing(undefined)}>
      <PlayerEdit player={editing} teams={teams} busy={busy} error={error} onSave={body => void run(async () => {
        const credential = await adminRequest<StudentCredential | null>(adminKey,"/players/" + editing.id,"PATCH",body);
        setEditing(undefined);
        if (credential) setCredentials([credential]);
      },"玩家資料已更新")}/>
    </Dialog>}
    {!!credentials.length && <Dialog title="學生登入資料" onClose={() => setCredentials([])}>
      <p className="muted">將學號和登入碼交給對應學生。之後可從玩家列表重發登入碼。</p>
      <div className="table-scroll"><table>
        <thead><tr><th>姓名</th><th>學號</th><th>登入碼</th></tr></thead>
        <tbody>{credentials.map(item => <tr key={item.id}><th scope="row">{item.name}</th>
          <td className="student-number">{item.studentNumber}</td><td><code className="issued-code">{item.code}</code></td></tr>)}</tbody>
      </table></div>
      <div className="admin-actions dialog-actions"><button className="button secondary" disabled={busy} onClick={() => void run(
        () => copyText(credentials.map(item => [item.name, item.studentNumber, item.code].join("\t")).join("\n")), "已複製登入資料")}>
        <Copy size={17}/> 複製登入資料</button></div>
      <ErrorText text={error}/>
    </Dialog>}
    {joinLink && <Dialog title="手機入場連結" onClose={() => setJoinLink("")}>
      <p className="muted">將專屬連結交給該玩家。</p><label className="field">入場連結<input readOnly value={joinLink}
        onFocus={event => event.target.select()}/></label>
      <div className="admin-actions dialog-actions"><button className="button secondary" onClick={() => void run(() => copyText(joinLink),"已複製連結")}>
        <Copy size={17}/> 複製連結</button></div>
    </Dialog>}
    {results && <Dialog title={results.name + " · 正式成績"} onClose={() => setResults(undefined)}>
      <ResultTable results={results.items} includeGames/>
    </Dialog>}
  </div>;
}
type Teams = NonNullable<CampusConnection["state"]>["leaderboard"]["teams"];
type PlayerDetails = { name?: string; studentNumber?: string; teamId?: string; swapId?: string };

function PlayerCreate({ teams, busy, error, onCreate }: {
  teams: Teams; busy: boolean; error: string; onCreate: (body: { name: string; studentNumber?: string; teamId?: string }) => void;
}) {
  const [name,setName] = useState("");
  const [team,setTeam] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const identity = studentNumberSchema.safeParse(studentNumber);
  const valid = nameSchema.safeParse(name).success && (!studentNumber.trim() || identity.success);
  return <form className="form-stack" onSubmit={event => {
    event.preventDefault();
    if (valid) onCreate({ name, teamId: team || undefined, studentNumber: identity.data });
  }}>
    <label>玩家名稱<input required maxLength={24} value={name} onChange={event => setName(event.target.value)}/></label>
    <label>學生證號碼<input value={studentNumber} maxLength={24} autoComplete="off" onChange={event => setStudentNumber(event.target.value)}/></label>
    <p className="muted small">填寫學號會產生 8 位登入碼。留空會產生手機入場連結。</p>
    <label>隊伍<select value={team} onChange={event => setTeam(event.target.value)}><option value="">自動分隊</option>
      {teams.map(team => <option key={team.id} value={team.id} disabled={team.members.length >= TEAM_SIZE}>{team.name}</option>)}</select></label>
    <ErrorText text={studentNumber.trim() && !identity.success ? "學號可用 2 至 24 個英數字、點、底線或連字號。" : error}/>
    <button className="button primary full" type="submit" disabled={busy || !valid}>新增玩家並產生登入資料</button>
  </form>;
}

function StudentImport({ available, busy, error, onImport }: {
  available: number; busy: boolean; error: string; onImport: (students: { studentNumber: string; name: string }[]) => void;
}) {
  const [list, setList] = useState("");
  const students: { studentNumber: string; name: string }[] = [];
  const numbers = new Set<string>();
  let problem = "";
  for (const [index, line] of list.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const cells = line.includes("\t") ? line.split("\t") : line.split(/[,，]/);
    const number = studentNumberSchema.safeParse(cells[0]);
    const name = nameSchema.safeParse(cells[1]);
    if (cells.length !== 2 || !number.success || !name.success) {
      problem = "第 " + (index + 1) + " 行格式有誤。請使用「學號、姓名」兩欄。";
      break;
    }
    if (numbers.has(number.data)) {
      problem = "第 " + (index + 1) + " 行的學號在名單中重複。";
      break;
    }
    numbers.add(number.data);
    students.push({ studentNumber: number.data, name: name.data });
  }
  if (students.length > available && !problem) problem = "可新增的名額剩 " + available + " 人。";
  return <form className="form-stack" onSubmit={event => {
    event.preventDefault();
    if (students.length && !problem) onImport(students);
  }}>
    <p className="muted">從試算表貼上學號和姓名兩欄，或每行以逗號分隔。系統會自動分隊。</p>
    <label>學生名單<textarea rows={7} maxLength={8000} placeholder={"00123,陳同學\n00124,李同學"} spellCheck={false}
      value={list} onChange={event => setList(event.target.value)} required/></label>
    <p className="muted small">已讀取 {students.length} 人 · 可新增 {available} 人</p>
    <ErrorText text={problem || error}/>
    <button className="button primary full" type="submit" disabled={busy || !!problem || !students.length}>
      匯入名單並產生登入碼
    </button>
  </form>;
}

function PlayerEdit({ player, teams, busy, error, onSave }: {
  player: AdminPlayer; teams: Teams; busy: boolean; error: string; onSave: (body: PlayerDetails) => void;
}) {
  const [name,setName] = useState(player.name);
  const [number, setNumber] = useState(player.studentNumber ?? "");
  const [team,setTeam] = useState(player.teamId);
  const [swap,setSwap] = useState("");
  const parsed = studentNumberSchema.safeParse(number);
  const valid = nameSchema.safeParse(name).success && (parsed.success || (!number.trim() && !player.studentNumber));
  const identityChanged = (parsed.data ?? null) !== player.studentNumber;
  const target = teams.find(item => item.id === team);
  const swapNeeded = team !== player.teamId && (target?.members.length ?? 0) >= TEAM_SIZE;
  return <div className="player-edit">
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      if (valid) onSave({ name, studentNumber: identityChanged ? parsed.data : undefined });
    }}>
      <label>玩家名稱<input required maxLength={24} value={name} onChange={event => setName(event.target.value)}/></label>
      <label>學生證號碼<input value={number} required={player.studentNumber !== null} maxLength={24}
        autoComplete="off" onChange={event => setNumber(event.target.value)}/></label>
      {identityChanged && parsed.success && <p className="muted small">更新學號會產生新的登入碼，並讓原手機登出。</p>}
      <ErrorText text={number.trim() && !parsed.success ? "學號可用 2 至 24 個英數字、點、底線或連字號。" : error}/>
      <button className="button secondary full" type="submit" disabled={busy || !valid || (!identityChanged && name === player.name)}>儲存帳號資料</button>
    </form>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); onSave({ teamId: team, swapId: swap || undefined }); }}>
      <label>隊伍<select value={team} onChange={event => { setTeam(event.target.value); setSwap(""); }}>
        {teams.map(team => <option key={team.id} value={team.id}>{team.name}　{team.members.length}/5</option>)}
      </select></label>
      {swapNeeded && <label><span><ArrowsLeftRight size={16}/> 交換隊員</span><select value={swap} onChange={event => setSwap(event.target.value)} required>
        <option value="">選擇另一名隊員</option>{target?.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select></label>}
      <button className="button primary full" type="submit" disabled={busy || team === player.teamId || (swapNeeded && !swap)}>儲存隊伍</button>
    </form>
  </div>;
}

function AdminSessions({ admin, adminKey, run, busy }: { admin: AdminState; adminKey: string; run: Run; busy: boolean }) {
  const [selected,setSelected] = useState<{ session: Session; results: Result[]; team: TeamResult | null }>();
  const [history,setHistory] = useState<Session[]>([]);
  const [next,setNext] = useState<number | null>();
  const [archived,setArchived] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const rows = archived ? history : admin.sessions;
  async function loadHistory(cursor?: number) {
    await run(async () => {
      const value = await adminRequest<{ sessions: Session[]; next: number | null }>(adminKey,"/sessions?before=" + (cursor ?? ""));
      setHistory(previous => cursor ? previous.concat(value.sessions) : value.sessions);
      setNext(value.next);
      setArchived(true);
    });
  }
  return <section className="panel admin-panel">
    <div className="section-line"><h2><Flag size={22}/> 正式場次紀錄</h2>
      <button className="button compact secondary" disabled={busy} type="button" onClick={() => archived ? setArchived(false) : void loadHistory()}>
        {archived ? "回到即時紀錄" : "查閱全部場次"}</button></div>
    {!rows.length ? <Empty title="等待首場遊戲結算"/> : <div className="table-scroll"><table>
      <thead><tr><th>結束時間</th><th>比賽</th><th>遊戲</th><th>站點</th><th>隊伍</th><th>關次</th><th>結果</th><th>紀錄</th></tr></thead>
      <tbody>{rows.map(session => <tr key={session.id}>
        <td>{formatTime(session.endedAt)}</td><td>{session.competitionId}</td><th scope="row">{gameById.get(session.gameId)?.name}</th>
        <td>{numberOf(session.stationId)}</td><td>{session.teamId ? <TeamTag id={session.teamId}/> : "—"}</td><td>{session.step ?? "—"}</td>
        <td>{session.voidedAt != null ? "成績已撤銷" : session.reason ? reasons[session.reason] : "已結算"}{session.status === "cancelled" ? " · 作廢" : ""}</td>
        <td><button className="button secondary compact" type="button" disabled={busy || session.status !== "finished"}
          onClick={() => void run(async () => {
            const details = await adminRequest<{ results: Result[]; team: TeamResult | null; voidedAt: number | null }>(adminKey,"/sessions/" + session.id);
            setSelected({ session: { ...session, voidedAt: details.voidedAt }, results: details.results, team: details.team });
            setVoiding(false);
            setVoidReason("");
          })}>查看結算</button></td>
      </tr>)}</tbody>
    </table></div>}
    {archived && next && <button className="button secondary" type="button" disabled={busy} onClick={() => void loadHistory(next)}>載入較早場次</button>}
    {selected && <Dialog title={gameById.get(selected.session.gameId)?.name + " · 結算"} onClose={() => setSelected(undefined)}>
      {selected.session.voidedAt != null && <p className="notice">成績已撤銷 · {formatTime(selected.session.voidedAt)}</p>}
      {selected.team && <p>原始分數合計 {selected.team.rawTotal} · 隊伍平均 {fmtScore(selected.team.average)} 分</p>}
      <ResultTable results={selected.results}/>
      {selected.session.voidedAt == null && (!voiding
        ? <button className="button danger" type="button" disabled={busy} onClick={() => setVoiding(true)}>撤銷成績</button>
        : <form className="form-stack" onSubmit={event => {
          event.preventDefault();
          const reason = voidReason.trim();
          if (!reason) return;
          void run(async () => {
            const { id } = selected.session;
            const { voidedAt } = await adminRequest<{ voidedAt: number }>(adminKey, "/sessions/" + id + "/void", "POST", { reason });
            setHistory(previous => previous.map(session => session.id === id ? { ...session, voidedAt } : session));
            setSelected(undefined);
          }, "已撤銷場次成績，排行榜已更新");
        }}>
          <p className="muted">本場將從積分及闖關進度扣除，原始紀錄與撤銷原因會保留。</p>
          <label>撤銷原因<input required maxLength={160} value={voidReason} onChange={event => setVoidReason(event.target.value)}/></label>
          <div className="admin-actions">
            <button className="button secondary" type="button" disabled={busy} onClick={() => setVoiding(false)}>返回結算</button>
            <button className="button danger" type="submit" disabled={busy || !voidReason.trim()}>確認撤銷成績</button>
          </div>
        </form>)}
    </Dialog>}
  </section>;
}
function ResultTable({ results, includeGames }: { results: Result[]; includeGames?: boolean }) {
  return results.length ? <div className="table-scroll"><table>
    <thead><tr><th>{includeGames ? "遊戲" : "參賽者"}</th><th>結果</th><th>原始分</th><th>基礎分</th><th>計入分</th><th>耗時</th><th>任務成果</th></tr></thead>
    <tbody>{results.map(item => <tr key={item.sessionId + item.playerId}><th scope="row">{includeGames ? gameById.get(item.gameId)?.name : item.playerName}</th>
      <td>{item.assisting && "陪打 · "}{item.tied ? "和" : item.outcome === "win" ? "勝" : item.outcome === "lose" ? "負" : "未參賽"}</td><td>{item.rawPoints}</td>
      <td>{fmtScore(item.baseAwarded)}</td><td className={item.awarded < 0 ? "negative-points" : "em-score"}>{fmtChange(item.awarded)}
        {item.doublePoints && " · 雙倍"}</td><td>{item.participated ? (item.duration / 1000).toFixed(2) + " 秒" : "—"}</td>
      <td>{item.metrics.correct !== undefined || item.metrics.sideAnswers ? <>
        {item.metrics.correct !== undefined && <div>個人答對 {item.metrics.correct} / 已答 {item.metrics.attempted}</div>}
        {item.metrics.sideAnswers && <div>本方答對 {item.metrics.sideAnswers.correct} / 已答 {item.metrics.sideAnswers.attempted}</div>}
      </> : item.metrics.progress ? item.metrics.progress.label + " " + item.metrics.progress.value + "/" + item.metrics.progress.target : "—"}</td></tr>)}</tbody>
  </table></div> : <Empty title="這裡還沒有正式成績"/>;
}

async function copyText(value: string) {
  if (navigator.clipboard) { await navigator.clipboard.writeText(value); return; }
  const selected = document.querySelector<HTMLInputElement>("dialog[open] input[readonly]");
  if (!selected) throw new Error("請選取欄位並手動複製");
  selected.select();
  if (!document.execCommand("copy")) throw new Error("請手動複製已選取的內容");
}

