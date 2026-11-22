import { useEffect, useState } from "react";
import {
  Crown,
  Medal,
  Pause,
  Play,
  Snowflake,
  Sparkle,
  TreeEvergreen,
  Trophy,
  UsersThree
} from "@phosphor-icons/react";
import type { TeamRank } from "../../../packages/shared/protocol";
import { ROUTE_LENGTH, ROUTE_MAX_BASE_SCORE } from "../../../packages/shared/route";
import { ChristmasGarland, KawaiiGingerbread, KawaiiReindeer, KawaiiSnowman, SnowHillsFooter } from "../../../packages/ui/christmas-art";
import { fmtScore, TeamTag } from "../../../packages/ui/components";
import type { CampusConnection } from "../../../packages/ui/network";
import "./christmas-leaderboard.css";

const AUTO_ROTATE_MS = 12_000;

function medalTitle(pos: 1 | 2 | 3) {
  if (pos === 1) return "聖誕冠軍 · 第 1 名";
  if (pos === 2) return "銀雪亞軍 · 第 2 名";
  return "薑餅季軍 · 第 3 名";
}

export function Leaderboard({ connection }: { connection: CampusConnection }) {
  const [tab, setTab] = useState<"personal" | "teams">("personal");
  const [autoRotate, setAutoRotate] = useState(false);
  const board = connection.state?.leaderboard;

  // 大屏自动轮播：每 12 秒在个人榜与队伍榜之间平滑切换
  useEffect(() => {
    if (!autoRotate) return;
    const timer = window.setInterval(() => {
      setTab(prev => (prev === "personal" ? "teams" : "personal"));
    }, AUTO_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [autoRotate]);

  const players = board?.players ?? [];
  const teams = board?.teams ?? [];
  const topPlayers = players.slice(0, 3);
  const topTeams = teams.filter(t => t.members.length > 0 || t.score > 0).slice(0, 3);
  const activeTeamsCount = teams.filter(t => t.members.length > 0).length;
  const highestScore = players.length ? players[0].totalScore : 0;

  return (
    <main id="main" className="shell xmas-stage">
      {/* 顶部圣诞彩灯挂串 */}
      <ChristmasGarland />

      {/* 圣诞雪国主横幅 */}
      <header className="xmas-hero" data-enter>
        <div className="xmas-hero-grid">
          <div className="xmas-hero-copy">
            <span className="xmas-eyebrow">
              <Snowflake size={16} weight="bold" />
              校園聖誕闖關賽
              <Sparkle size={15} weight="fill" />
            </span>
            <h1>
              <KawaiiSnowman size={54} />
              <span>聖誕即時排行榜</span>
              <KawaiiReindeer size={52} />
            </h1>
            <p className="xmas-hero-sub">
              {ROUTE_LENGTH} 關全勝基礎 {ROUTE_MAX_BASE_SCORE} 分。
            </p>
            <div className="xmas-stats-row">
              <span className="xmas-stat-pill">
                <Trophy size={16} weight="duotone" color="#d9383a" />
                參賽玩家 <strong>{players.length}</strong> 位
              </span>
              <span className="xmas-stat-pill green">
                <UsersThree size={16} weight="duotone" color="#1d7a52" />
                活躍隊伍 <strong>{activeTeamsCount}</strong> 隊
              </span>
              <span className="xmas-stat-pill gold">
                <Crown size={16} weight="duotone" color="#d4941d" />
                目前最高 <strong>{fmtScore(highestScore)}</strong> 分
              </span>
            </div>
          </div>

          <div className="xmas-toolbar">
            <div className="xmas-tabs" role="group" aria-label="排行切換">
              <button
                type="button"
                className="xmas-tab-btn"
                aria-pressed={tab === "personal"}
                onClick={() => { setTab("personal"); setAutoRotate(false); }}
              >
                <Trophy size={18} weight={tab === "personal" ? "fill" : "bold"} />
                個人排行
              </button>
              <button
                type="button"
                className="xmas-tab-btn"
                aria-pressed={tab === "teams"}
                onClick={() => { setTab("teams"); setAutoRotate(false); }}
              >
                <UsersThree size={18} weight={tab === "teams" ? "fill" : "bold"} />
                隊伍排行
              </button>
            </div>

            <div className="xmas-actions">
              <button
                type="button"
                className="xmas-chip-btn"
                aria-pressed={autoRotate}
                onClick={() => setAutoRotate(v => !v)}
              >
                {autoRotate ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
                {autoRotate ? "暫停自動輪播" : "每 12 秒切換榜單"}
              </button>
            </div>
          </div>
        </div>

        {autoRotate && (
          <div className="xmas-rotate-bar" aria-hidden="true">
            <div key={tab} className="xmas-rotate-fill" />
          </div>
        )}
      </header>

      {/* 個人排行：前三名聖誕領獎台 + 完整榜單 */}
      {tab === "personal" ? (
        <>
          {topPlayers.length > 0 && (
            <section className="xmas-podium" aria-label="個人前三名榮耀領獎台" data-enter>
              {topPlayers.map((player, index) => {
                const pos = (index + 1) as 1 | 2 | 3;
                return (
                  <article key={player.id} className={`xmas-podium-card rank-pos-${pos}`}>
                    <div className="xmas-crown-wrap" aria-hidden="true">
                      {pos === 1 ? <Crown size={38} weight="fill" /> : <Medal size={32} weight="fill" />}
                    </div>
                    <span className="xmas-medal-label">{medalTitle(pos)}</span>
                    <h2 className="xmas-podium-name">{player.name}</h2>
                    <TeamTag id={player.teamId} name={player.teamName} />
                    <div className="xmas-podium-score">
                      {fmtScore(player.totalScore)}
                      <small>分</small>
                    </div>
                    <div className="xmas-podium-meta">
                      <span>完成 {Math.min(player.completed, ROUTE_LENGTH)}/{ROUTE_LENGTH} 關</span>
                      <span>{player.wins} 勝 {player.ties} 和 {player.losses} 負</span>
                    </div>
                  </article>
                );
              })}
            </section>
          )}

          <section className="xmas-board-card" aria-label="個人完整排行榜">
            <div className="xmas-board-head">
              <h2>
                <Trophy size={20} weight="fill" color="#ffe285" />
                個人積分總榜
              </h2>
              <span>共 {players.length} 位參賽者</span>
            </div>

            {!players.length ? (
              <div className="xmas-empty">
                <div className="xmas-idle-mascots">
                  <KawaiiSnowman size={66} />
                  <KawaiiGingerbread size={62} />
                  <KawaiiReindeer size={66} />
                </div>
                <strong>{board ? "等待聖誕選手入場" : "正在載入個人排名…"}</strong>
                <p>同學掃碼加入活動並完成關卡後，名次與積分就會即時呈現在這裡。</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {["名次", "玩家", "所屬隊伍", "闖關進度", "勝 / 和 / 負", "總積分"].map(text => (
                        <th key={text}>{text}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {players.map(player => {
                      const done = Math.min(player.completed, ROUTE_LENGTH);
                      const pct = Math.round((done / ROUTE_LENGTH) * 100);
                      return (
                        <tr key={player.id} className={player.rank <= 3 ? "is-top-3" : undefined}>
                          <td>
                            <span className={`xmas-ornament-rank r-${player.rank}`}>
                              {player.rank}
                            </span>
                          </td>
                          <th scope="row">{player.name}</th>
                          <td>
                            <TeamTag id={player.teamId} name={player.teamName} />
                          </td>
                          <td>
                            <div className="xmas-progress-cell">
                              <div className="xmas-progress-track">
                                <div className="xmas-progress-fill" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="xmas-progress-text">{done} / {ROUTE_LENGTH}</span>
                            </div>
                          </td>
                          <td>
                            <span className="xmas-wld">
                              <b className="w">{player.wins}勝</b>
                              <b className="d">{player.ties}和</b>
                              <b className="l">{player.losses}負</b>
                            </span>
                          </td>
                          <td className="xmas-total-score">{fmtScore(player.totalScore)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        /* 隊伍排行：前三名隊伍領獎台 + 隊伍總榜 */
        <>
          {topTeams.length > 0 && (
            <section className="xmas-podium" aria-label="隊伍前三名榮耀領獎台" data-enter>
              {topTeams.map((team, index) => {
                const pos = (index + 1) as 1 | 2 | 3;
                const totalCompleted = team.members.reduce((sum, p) => sum + Math.min(p.completed, ROUTE_LENGTH), 0);
                return (
                  <article key={team.id} className={`xmas-podium-card rank-pos-${pos}`}>
                    <div className="xmas-crown-wrap" aria-hidden="true">
                      {pos === 1 ? <Crown size={38} weight="fill" /> : <Medal size={32} weight="fill" />}
                    </div>
                    <span className="xmas-medal-label">{medalTitle(pos)}</span>
                    <h2 className="xmas-podium-name">{team.name}</h2>
                    <TeamTag id={team.id} name={`${team.members.length} 位隊員`} />
                    <div className="xmas-podium-score">
                      {fmtScore(team.score)}
                      <small>均分</small>
                    </div>
                    <div className="xmas-podium-meta">
                      <span>完成 {totalCompleted} 關</span>
                      <span>累積 {team.wins} 勝</span>
                    </div>
                    {team.members.length > 0 && (
                      <p className="xmas-podium-roster">
                        {team.members.map(m => m.name).join("、")}
                      </p>
                    )}
                  </article>
                );
              })}
            </section>
          )}

          <section className="xmas-board-card" aria-label="隊伍完整排行榜">
            <div className="xmas-board-head">
              <h2>
                <UsersThree size={20} weight="fill" color="#ffe285" />
                隊伍均分總榜
              </h2>
              <span>共 {teams.length} 支隊伍</span>
            </div>

            {!board ? (
              <div className="xmas-empty">
                <div className="xmas-empty-icon">
                  <TreeEvergreen size={34} weight="duotone" />
                </div>
                <strong>正在載入隊伍排名...</strong>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {["名次", "隊伍", "成員名單", "團隊進度", "累積勝場", "隊員平均分"].map(text => (
                        <th key={text}>{text}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map(team => {
                      const done = team.members.reduce((sum, p) => sum + Math.min(p.completed, ROUTE_LENGTH), 0);
                      const maxSteps = ROUTE_LENGTH * 5;
                      const pct = Math.round((done / maxSteps) * 100);
                      return (
                        <tr key={team.id} className={team.rank <= 3 && team.members.length > 0 ? "is-top-3" : undefined}>
                          <td>
                            <span className={`xmas-ornament-rank r-${team.rank}`}>
                              {team.rank}
                            </span>
                          </td>
                          <th scope="row">
                            <TeamTag id={team.id} name={team.name} />
                          </th>
                          <td>
                            <div className="xmas-roster-wrap">
                              <span>{team.members.length ? team.members.map(m => m.name).join("、") : "等待隊員加入"}</span>
                              <span className="xmas-roster-count">{team.members.length}/5</span>
                            </div>
                          </td>
                          <td>
                            <div className="xmas-progress-cell">
                              <div className="xmas-progress-track">
                                <div className="xmas-progress-fill" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="xmas-progress-text">{done} / {maxSteps}</span>
                            </div>
                          </td>
                          <td>
                            <span className="xmas-wld">
                              <b className="w">{team.wins} 勝</b>
                            </span>
                          </td>
                          <td className="xmas-total-score">{fmtScore(team.score)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* 底部雪丘点缀 */}
      <SnowHillsFooter />
    </main>
  );
}
