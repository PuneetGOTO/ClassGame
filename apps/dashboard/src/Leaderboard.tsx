import { useState } from "react";
import { Trophy, UsersThree } from "@phosphor-icons/react";
import { ROUTE_LENGTH, ROUTE_MAX_BASE_SCORE } from "../../../packages/shared/route";
import { Empty, fmtScore, TeamTag } from "../../../packages/ui/components";
import type { CampusConnection } from "../../../packages/ui/network";

export function Leaderboard({ connection }: { connection: CampusConnection }) {
  const [tab, setTab] = useState<"personal" | "teams">("personal");
  const board = connection.state?.leaderboard;
  return <main id="main" className="shell dashboard">
    <div className="page-intro" data-enter><div><p className="eyebrow"><Trophy size={18}/> 校園即時闖關</p>
      <h1>即時排行榜</h1><p className="muted">{ROUTE_LENGTH} 關全勝基礎 {ROUTE_MAX_BASE_SCORE} 分，總分在每場結算後即時更新。</p></div></div>
    <div className="segmented rank-tabs"><button aria-pressed={tab === "personal"} onClick={() => setTab("personal")}><Trophy size={18}/> 個人排行</button>
      <button aria-pressed={tab === "teams"} onClick={() => setTab("teams")}><UsersThree size={18}/> 隊伍排行</button></div>
    {tab === "personal" ? <section className="panel ranking">
      {!board?.players.length ? <Empty title={board ? "等待玩家加入" : "載入個人排名"}>玩家加入活動後會出現在這裡。</Empty>
        : <div className="table-scroll"><table><thead><tr>{["名次","玩家","隊伍","完成關卡","勝","和","負","總積分"].map(text => <th key={text}>{text}</th>)}</tr></thead>
          <tbody>{board.players.map(player => <tr key={player.id}><td><span className={"rank rank-" + player.rank}>{player.rank}</span></td>
            <th scope="row">{player.name}</th><td><TeamTag id={player.teamId} name={player.teamName}/></td>
            <td>{Math.min(player.completed, ROUTE_LENGTH)} / {ROUTE_LENGTH}</td><td>{player.wins}</td><td>{player.ties}</td><td>{player.losses}</td>
            <td className="em-score">{fmtScore(player.totalScore)}</td></tr>)}</tbody></table></div>}
    </section> : <section className="panel ranking">
      {!board ? <Empty title="載入隊伍排名"/> : <div className="table-scroll"><table><thead><tr>
        {["名次","隊伍","成員","完成紀錄","勝利紀錄","隊員平均分"].map(text => <th key={text}>{text}</th>)}</tr></thead>
        <tbody>{board.teams.map(team => <tr key={team.id}><td><span className={"rank rank-" + team.rank}>{team.rank}</span></td>
          <th scope="row"><TeamTag id={team.id} name={team.name}/></th><td className="roster-cell">
            {team.members.length ? team.members.map(member => member.name).join("、") : "等待隊員"} <span>{team.members.length}/5</span>
          </td><td>{team.members.reduce((sum, player) => sum + Math.min(player.completed, ROUTE_LENGTH), 0)} / {ROUTE_LENGTH * 5}</td><td>{team.wins}</td><td className="em-score">{fmtScore(team.score)}</td></tr>)}</tbody>
      </table></div>}
    </section>}
  </main>;
}

