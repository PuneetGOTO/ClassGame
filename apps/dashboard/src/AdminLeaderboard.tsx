import { useEffect, useState } from "react";
import { DownloadSimple, Trophy, Warning } from "@phosphor-icons/react";
import type { AdminState, Leaderboard } from "../../../packages/shared/protocol";
import { Dialog, Empty, ErrorText, fmtScore, TeamTag } from "../../../packages/ui/components";
import { adminRequest, message } from "../../../packages/ui/network";

export type ScoreScope = "players" | "teams";
type Run = (operation: () => Promise<void>, success?: string) => Promise<void>;

export function AdminLeaderboard({ admin, live, adminKey, busy, error, run, exportCsv }: {
  admin: AdminState; live?: Leaderboard; adminKey: string; busy: boolean; error: string; run: Run;
  exportCsv: (scope: ScoreScope, competitionId: number) => void;
}) {
  const [historicId, setHistoricId] = useState<number>();
  const [archive, setArchive] = useState<{ id: number; board?: Leaderboard; error?: string }>();
  const [scope, setScope] = useState<ScoreScope>("players");
  const [confirmation, setConfirmation] = useState<{ id: number; reason: string; phrase: string }>();
  const selectedId = historicId ?? admin.competitionId;
  const isCurrent = selectedId === admin.competitionId;
  const edition = admin.competitions.find(item => item.id === selectedId);
  const board = isCurrent ? live : archive?.id === selectedId ? archive.board : undefined;
  const archiveError = !isCurrent && archive?.id === selectedId ? archive.error : undefined;
  const rows = scope === "players" ? board?.players : board?.teams;

  useEffect(() => {
    if (historicId == null) return;
    let active = true;
    void adminRequest<Leaderboard>(adminKey, "/leaderboard?competition=" + historicId).then(value => {
      if (active) setArchive({ id: historicId, board: value });
    }).catch(failure => {
      if (active) setArchive({ id: historicId, error: message(failure) });
    });
    return () => { active = false; };
  }, [adminKey, historicId]);

  return <div className="admin-columns admin-leaderboard">
    <section className="panel admin-panel">
      <h2><Trophy size={22}/> 排行榜</h2>
      <div className="admin-rank-toolbar">
        <label className="field">比賽屆別<select value={historicId ?? ""} onChange={event => {
          setHistoricId(event.target.value ? Number(event.target.value) : undefined);
        }}>
          <option value="">第 {admin.competitionId} 屆 · 進行中</option>
          {admin.competitions.filter(item => item.id !== admin.competitionId).map(item =>
            <option key={item.id} value={item.id}>第 {item.id} 屆 · 已封存</option>)}
        </select></label>
        <button className="button compact secondary" disabled={!board || busy} onClick={() => exportCsv(scope, selectedId)}>
          <DownloadSimple size={17}/> 匯出{scope === "players" ? "個人" : "隊伍"} CSV
        </button>
      </div>
      {edition?.resetReason && <p className="muted">封存原因 · {edition.resetReason}</p>}
      <div className="segmented" aria-label="排行榜種類">
        <button type="button" aria-pressed={scope === "players"} onClick={() => setScope("players")}>個人排行</button>
        <button type="button" aria-pressed={scope === "teams"} onClick={() => setScope("teams")}>隊伍排行</button>
      </div>
      {archiveError ? <ErrorText text={archiveError}/> : !rows ? <Empty title="載入排行榜"/>
        : !rows.length ? <Empty title="本屆沒有參賽紀錄"/>
        : <div className="table-scroll"><table>
          <thead><tr><th>名次</th><th>{scope === "players" ? "玩家" : "隊伍"}</th>
            {scope === "players" && <th>隊伍</th>}<th>完成</th><th>勝</th>
            {scope === "players" && <><th>和</th><th>負</th></>}<th>{scope === "players" ? "總積分" : "平均分"}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td className="rank">{row.rank}</td>
            <th scope="row">{"teamId" in row ? row.name : <TeamTag id={row.id} name={row.name}/>}</th>
            {"teamId" in row && <td><TeamTag id={row.teamId} name={row.teamName}/></td>}
            <td>{row.completed}</td><td>{row.wins}</td>
            {"ties" in row && <><td>{row.ties}</td><td>{row.losses}</td></>}
            <td className="em-score">{fmtScore("totalScore" in row ? row.totalScore : row.score)}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>

    <section className="panel admin-panel">
      <h2><Warning size={22}/> 重置排行榜</h2>
      <p className="muted">封存目前一屆並開啟新一屆。玩家及隊伍沿用，新一屆積分和闖關進度從零開始。</p>
      <dl className="station-values admin-system">
        <div><dt>目前屆別</dt><dd>第 {admin.competitionId} 屆</dd></div>
        <div><dt>候場或遊戲中</dt><dd>{admin.liveRooms} 場</dd></div>
        <div><dt>搜尋對手或等候陪打</dt><dd>{admin.queuedPlayers} 人</dd></div>
      </dl>
      <button type="button" className="button danger" disabled={busy}
        onClick={() => setConfirmation({ id: admin.competitionId, reason: "", phrase: "" })}>
        重置第 {admin.competitionId} 屆
      </button>
    </section>

    {confirmation && <Dialog title={"重置第 " + confirmation.id + " 屆排行榜"} onClose={() => setConfirmation(undefined)}>
      <p className="muted">正在進行的正式場次會取消，配對等候名單會清空。舊屆成績可從屆別選單查閱及匯出。</p>
      <form className="form-stack" onSubmit={event => {
        event.preventDefault();
        if (confirmation.phrase !== "RESET" || !confirmation.reason.trim()) return;
        void run(async () => {
          await adminRequest(adminKey, "/competition/reset", "POST", {
            competitionId: confirmation.id, reason: confirmation.reason.trim(), confirm: confirmation.phrase
          });
          setHistoricId(undefined);
          setConfirmation(undefined);
        }, "已封存舊屆並開啟新一屆");
      }}>
        <label>重置原因<input required maxLength={160} value={confirmation.reason}
          onChange={event => setConfirmation({ ...confirmation, reason: event.target.value })}/></label>
        <label>輸入 RESET 確認<input required autoComplete="off" value={confirmation.phrase}
          onChange={event => setConfirmation({ ...confirmation, phrase: event.target.value })}/></label>
        <ErrorText text={error}/>
        <button className="button danger full" type="submit" disabled={busy || !confirmation.reason.trim() || confirmation.phrase !== "RESET"}>
          確認重置排行榜
        </button>
      </form>
    </Dialog>}
  </div>;
}
