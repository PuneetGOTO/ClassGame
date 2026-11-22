import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import {
  fixedId, GAMES, PLAYER_LIMIT, SCORE_SCALE, STATION_COUNT, TEAM_COUNT, TEAM_SIZE
} from "../../../packages/shared/catalog";
import { FLOORS, originalFloorStations, planPosition, type Floor } from "../../../packages/shared/floors";
import type { AdminState, EndReason, Leaderboard, PlayerIdentity, PlayerRank, Result, RoomStatus, StationView, TeamRank, TeamResult } from "../../../packages/shared/protocol";
import { migrations } from "./migrations";
import { shuffled } from "../../../packages/game-sdk";

export class RequestError extends Error {
  constructor(message: string, public readonly code = "invalid", public readonly status = 400) { super(message); }
}

export interface PlayerRow {
  player_id: string; player_name: string; team_id: string; connected: number; total_score: number;
  token_hash: string | null;
}
export interface SessionRow {
  session_id: string; competition_id: number; game_id: string; station_id: string; host_id: string;
  team_id: string | null; round_no: number; created_at: number; started_at: number | null;
  deadline: number | null; ended_at: number | null; status: RoomStatus; reason: EndReason | null;
  seed: number; engine_state: string | null; roster: string;
  double_due_at: number | null; double_player_id: string | null; double_started_at: number | null;
  route_step?: number;
}
export interface MemberRow {
  player_id: string; team_id: string; ready: number; participated: number; forfeited: number;
  last_seq: number; won_at: number | null;
  played: number;
}
export interface QueueRow { ticket: number; station_id: string; player_id: string; team_id: string; created_at: number }
export interface RouteStep { step: number; gameId: string; stationId: string; seed: number }
interface SQLRank extends PlayerRank { soloUnits: number; multiUnits: number }
interface TeamRow { team_id: string; team_name: string; member_count: number }
type ResultRow = Omit<Result, "participated" | "metrics"> & { participated: number; metrics: string };

const resultFields = `
  r.player_id AS playerId, p.player_name AS playerName, r.session_id AS sessionId, r.game_id AS gameId,
  r.team_id AS teamId, r.round_no AS round, NULLIF(r.route_step,0) AS step, r.participated, r.win_or_lose AS outcome, r.raw_points AS rawPoints,
  r.awarded_units * r.score_weight / 5.0 AS baseAwarded, r.awarded_points AS awarded, r.adjustment_units <> 0 AS doublePoints,
  r.duration, r.created_at AS date, r.metrics
`;
const teamResultFields = `
  session_id AS sessionId, team_id AS teamId, game_id AS gameId, round_no AS round,
  total_raw_points AS rawTotal, team_average_points AS average, created_at AS date
`;
const asResult = (row: ResultRow): Result => ({
  ...row, participated: Boolean(row.participated), doublePoints: Boolean(row.doublePoints), metrics: JSON.parse(row.metrics)
});
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const nameKey = (name: string) => name.normalize("NFKC").toLocaleLowerCase("zh-Hant").trim();

export class Store {
  readonly db: DatabaseSync;
  competitionId: number;
  private statements = new Map<string, StatementSync>();

  constructor(path: string, now: number) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    const current = this.get<{ user_version: number }>("PRAGMA user_version")!.user_version;
    if (current > migrations.at(-1)!.version) throw new Error("SQLite 資料庫版本高於應用程式版本");
    for (const migration of migrations.filter(item => item.version > current)) {
      this.transaction(() => this.db.exec(migration.sql + "PRAGMA user_version = " + migration.version + ";"));
    }
    const active = this.get<{ id: number; play_format: string }>("SELECT id,play_format FROM competitions WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1");
    this.competitionId = active?.id ?? this.createCompetition(now);
    this.transaction(() => {
      this.db.exec("UPDATE players SET connected = 0; UPDATE hosts SET connection_status = 0;");
      for (let index = 1; index <= TEAM_COUNT; index++) {
        this.run("INSERT OR IGNORE INTO teams(team_id,team_name) VALUES (?,?)", fixedId("TEAM", index), "第 " + index + " 隊");
      }
      for (const game of GAMES) {
        this.run(`INSERT INTO games(game_id,game_name,category,mode,time_limit,plugin_path,win_condition)
          VALUES (?,?,?,?,60,?,?) ON CONFLICT(game_id) DO UPDATE SET game_name=excluded.game_name,
          category=excluded.category,mode=excluded.mode,plugin_path=excluded.plugin_path,win_condition=excluded.win_condition`,
          game.id, game.name, game.category, "solo", "local-games/" + game.id, game.objective);
      }
      for (let index = 1; index <= STATION_COUNT; index++) {
        const hostId = fixedId("HOST", index);
        const stationId = fixedId("STATION", index);
        const [floor, name, photoX, photoY] = originalFloorStations[index - 1];
        const [x, y] = planPosition(floor, photoX, photoY);
        if (this.get("SELECT station_id FROM campus_stations WHERE station_id=?", stationId)) continue;
        this.run("INSERT INTO campus_stations(station_id,station_name,floor,position_x,position_y) VALUES (?,?,?,?,?)", stationId, name, floor, x, y);
        this.run("INSERT INTO hosts(host_id,station_id,assigned_game_id) VALUES (?,?,?)", hostId, stationId, GAMES[index - 1].id);
        this.run("UPDATE campus_stations SET assigned_host_id=? WHERE station_id=?", hostId, stationId);
      }
    });
    if (active?.play_format === "legacy") this.upgradeCompetition(now);
  }

  private createCompetition(now: number) {
    return Number(this.run("INSERT INTO competitions(created_at,play_format) VALUES (?,'individual')", now).lastInsertRowid);
  }
  private upgradeCompetition(now: number) {
    const legacy = this.competitionId;
    const played = this.get("SELECT 1 FROM game_sessions WHERE competition_id=? LIMIT 1", legacy);
    if (played) {
      this.resetCompetition(now, "competition.upgrade");
    } else {
      this.transaction(() => {
        this.run("UPDATE competitions SET play_format='individual' WHERE id=?", legacy);
        this.run("DELETE FROM station_queue");
      });
    }
  }

  private statement(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined { return this.statement(sql).get(...params) as T | undefined; }
  all<T>(sql: string, ...params: SQLInputValue[]): T[] { return this.statement(sql).all(...params) as T[]; }
  run(sql: string, ...params: SQLInputValue[]) { return this.statement(sql).run(...params); }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  player(id: string) { return this.get<PlayerRow>("SELECT * FROM players WHERE player_id=?", id); }
  playerFromToken(token: string) { return this.get<PlayerRow>("SELECT * FROM players WHERE token_hash=?", hash(token)); }
  players() { return this.all<PlayerRow>("SELECT * FROM players ORDER BY created_at, player_id"); }
  publicPlayer(player: PlayerRow): PlayerIdentity {
    return { id: player.player_id, name: player.player_name, teamId: player.team_id, connected: Boolean(player.connected), totalScore: player.total_score };
  }

  addPlayer(name: string, selectedTeam: string | undefined, now: number) {
    return this.transaction(() => {
      if (this.get<{ total: number }>("SELECT COUNT(*) AS total FROM players")!.total >= PLAYER_LIMIT) {
        throw new RequestError("50 個正式名額已滿", "full", 409);
      }
      if (this.get("SELECT player_id FROM players WHERE name_key=?", nameKey(name))) {
        throw new RequestError("此玩家名稱已登記，請用原手機或向管理員取得連結", "name-taken", 409);
      }
      const team = selectedTeam
        ? this.get<TeamRow>("SELECT * FROM teams WHERE team_id=? AND member_count < ?", selectedTeam, TEAM_SIZE)
        : this.get<TeamRow>("SELECT * FROM teams WHERE member_count < ? ORDER BY team_id LIMIT 1", TEAM_SIZE);
      if (!team) throw new RequestError("該隊已滿，請選擇其他隊伍", "team-full", 409);
      const id = randomUUID();
      const token = randomBytes(32).toString("base64url");
      this.run("INSERT INTO players(player_id,player_name,name_key,team_id,token_hash,created_at) VALUES (?,?,?,?,?,?)",
        id, name, nameKey(name), team.team_id, hash(token), now);
      this.writeRoute(id);
      return { id, token };
    });
  }

  rotateToken(id: string) {
    if (!this.player(id)) throw new RequestError("找不到玩家", "not-found", 404);
    const token = randomBytes(32).toString("base64url");
    this.run("UPDATE players SET token_hash=? WHERE player_id=?", hash(token), id);
    return token;
  }

  renamePlayer(id: string, name: string) {
    const existing = this.get<PlayerRow>("SELECT * FROM players WHERE name_key=?", nameKey(name));
    if (existing && existing.player_id !== id) throw new RequestError("此玩家名稱已登記", "name-taken", 409);
    this.run("UPDATE players SET player_name=?, name_key=? WHERE player_id=?", name, nameKey(name), id);
  }

  setTeam(id: string, teamId: string, swapId?: string) {
    this.transaction(() => {
      const player = this.player(id);
      if (!player) throw new RequestError("找不到玩家", "not-found", 404);
      if (player.team_id === teamId) return;
      if (swapId) {
        if (this.player(swapId)?.team_id !== teamId) throw new RequestError("交換對象必須是目標隊伍成員");
        this.run("UPDATE players SET team_id=CASE player_id WHEN ? THEN ? ELSE ? END WHERE player_id IN (?,?)",
          id, teamId, player.team_id, id, swapId);
        return;
      }
      const team = this.get<TeamRow>("SELECT * FROM teams WHERE team_id=?", teamId);
      if (!team || team.member_count >= TEAM_SIZE) throw new RequestError("該隊已滿，請指定交換隊員", "team-full", 409);
      this.run("UPDATE players SET team_id=? WHERE player_id=?", teamId, id);
      this.run("UPDATE teams SET member_count=member_count-1 WHERE team_id=?", player.team_id);
      this.run("UPDATE teams SET member_count=member_count+1 WHERE team_id=?", teamId);
    });
  }

  autoTeams() {
    this.transaction(() => {
      const players = this.players();
      // Reassignment is a single transaction, so membership is never visible half-updated.
      for (const [index, player] of players.entries()) {
        this.run("UPDATE players SET team_id=? WHERE player_id=?", fixedId("TEAM", Math.floor(index / TEAM_SIZE) + 1), player.player_id);
      }
      this.db.exec("UPDATE teams SET member_count=(SELECT COUNT(*) FROM players WHERE players.team_id=teams.team_id)");
    });
  }

  round(gameId: string) {
    return this.get<{ round_no: number }>("SELECT round_no FROM game_rounds WHERE competition_id=? AND game_id=?", this.competitionId, gameId)?.round_no ?? 1;
  }
  reopen(gameId: string, now: number) {
    return this.transaction(() => {
      const next = this.round(gameId) + 1;
      this.run(`INSERT INTO game_rounds VALUES (?,?,?) ON CONFLICT(competition_id,game_id) DO UPDATE SET round_no=excluded.round_no`,
        this.competitionId, gameId, next);
      this.audit("round.open", gameId + " · " + next, now);
      return next;
    });
  }
  stationRows() {
    return this.all<Omit<StationView, "activity" | "round">>(`
      SELECT s.station_id AS id,s.station_name AS name,s.floor,s.position_x AS x,s.position_y AS y,s.open,
        h.host_id AS hostId,h.assigned_game_id AS gameId,h.connection_status AS online,
        (SELECT COUNT(*) FROM station_queue q WHERE q.station_id=s.station_id) AS queued,
        (SELECT COUNT(*) FROM game_sessions gs WHERE gs.station_id=s.station_id AND gs.competition_id=? AND gs.status='finished') AS completed
      FROM campus_stations s JOIN hosts h ON s.assigned_host_id=h.host_id ORDER BY s.station_id
    `, this.competitionId);
  }
  queue(stationId: string) {
    return this.all<QueueRow>("SELECT * FROM station_queue WHERE station_id=? ORDER BY ticket", stationId);
  }
  ensureRoute(playerId: string) {
    if (this.get("SELECT 1 FROM player_routes WHERE competition_id=? AND player_id=? LIMIT 1", this.competitionId, playerId)) return;
    this.transaction(() => this.writeRoute(playerId));
  }
  private writeRoute(playerId: string) {
    const stations = this.all<{ gameId: string; floor: Floor; assigned: number }>(`
      SELECT h.assigned_game_id AS gameId,s.floor,(SELECT COUNT(*) FROM player_routes r
        WHERE r.competition_id=? AND r.step=1 AND r.game_id=h.assigned_game_id) AS assigned
      FROM campus_stations s JOIN hosts h ON h.station_id=s.station_id ORDER BY assigned,s.station_id
    `, this.competitionId);
    if (stations.length !== GAMES.length || new Set(stations.map(item => item.gameId)).size !== GAMES.length) {
      throw new Error("每款遊戲必須有一個固定站點");
    }
    const leastAssigned = stations.filter(item => item.assigned === stations[0].assigned);
    const first = leastAssigned[randomInt(leastAssigned.length)];
    const rest = stations.filter(item => item !== first);
    const sameFloor = rest.filter(item => item.floor === first.floor);
    const otherFloor = rest.filter(item => item.floor !== first.floor);
    let ordered;
    do {
      ordered = [first, ...shuffled(sameFloor, randomInt), ...shuffled(otherFloor, randomInt)];
    } while (this.get(`SELECT 1 FROM player_routes WHERE competition_id=? GROUP BY player_id
      HAVING group_concat(game_id, ',' ORDER BY step)=? LIMIT 1`, this.competitionId, ordered.map(item => item.gameId).join(",")));
    for (const [index, { gameId }] of ordered.entries()) {
      let inserted = false;
      while (!inserted) {
        inserted = Boolean(this.run(`INSERT INTO player_routes(competition_id,player_id,step,game_id,seed) VALUES (?,?,?,?,?)
          ON CONFLICT(competition_id,game_id,seed) DO NOTHING`, this.competitionId, playerId, index + 1, gameId,
          randomInt(0x1_0000_0000)).changes);
      }
    }
  }
  nextRoute(playerId: string) {
    return this.get<RouteStep>(`SELECT r.step,r.game_id AS gameId,h.station_id AS stationId,r.seed
      FROM player_routes r JOIN hosts h ON h.assigned_game_id=r.game_id
      LEFT JOIN official_results o ON o.competition_id=r.competition_id AND o.player_id=r.player_id AND o.game_id=r.game_id
      WHERE r.competition_id=? AND r.player_id=? AND o.result_id IS NULL ORDER BY r.step LIMIT 1`, this.competitionId, playerId);
  }
  mapStatus() {
    const rows = this.all<{ floor: Floor; revision: number; custom: number }>(
      "SELECT floor,revision,image IS NOT NULL AS custom FROM floor_maps"
    );
    return Object.fromEntries(FLOORS.map(floor => {
      const row = rows.find(item => item.floor === floor)!;
      return [floor, { revision: row.revision, custom: Boolean(row.custom) }];
    })) as Record<Floor, { revision: number; custom: boolean }>;
  }
  doubleChance() {
    return this.get<{ double_chance: number }>("SELECT double_chance FROM settings")!.double_chance;
  }
  officialFor(playerId: string, competitionId = this.competitionId) {
    return this.all<ResultRow>(`SELECT ${resultFields} FROM official_results o JOIN game_results r USING(result_id)
      JOIN players p ON p.player_id=r.player_id WHERE o.competition_id=? AND o.player_id=?
      ORDER BY CASE WHEN r.route_step>0 THEN r.route_step ELSE 100 END,r.game_id`, competitionId, playerId).map(asResult);
  }
  recentFor(playerId: string) {
    const result = this.get<ResultRow>(`SELECT ${resultFields} FROM game_results r JOIN players p ON p.player_id=r.player_id
      WHERE r.competition_id=? AND r.player_id=? AND r.participated=1 ORDER BY r.result_id DESC LIMIT 1`, this.competitionId, playerId);
    return result ? asResult(result) : null;
  }
  resultsForSession(sessionId: string) {
    return this.all<ResultRow>(`SELECT ${resultFields} FROM game_results r JOIN players p ON p.player_id=r.player_id WHERE r.session_id=? ORDER BY r.result_id`, sessionId).map(asResult);
  }
  teamResult(sessionId: string) {
    return this.get<TeamResult>(`SELECT ${teamResultFields} FROM team_results WHERE session_id=?`, sessionId) ?? null;
  }
  sessionHistory(before: number, limit: number) {
    const records = this.all<AdminState["sessions"][number] & { cursor: number }>(`SELECT rowid AS cursor,
      session_id AS id,station_id AS stationId,game_id AS gameId,competition_id AS competitionId,
      team_id AS teamId,round_no AS round,NULLIF(route_step,0) AS step,status,started_at AS startedAt,ended_at AS endedAt,reason
      FROM game_sessions WHERE rowid<? AND status IN ('finished','cancelled') ORDER BY rowid DESC LIMIT ?`, before, limit + 1);
    const next = records.length > limit ? records[limit - 1].cursor : null;
    return { sessions: records.slice(0, limit).map(({ cursor: _, ...record }) => record), next };
  }
  leaderboard(): Leaderboard {
    const order = (a: { completed: number; wins: number; duration: number }, b: typeof a) =>
      b.completed - a.completed || b.wins - a.wins || a.duration - b.duration;
    const players = this.all<SQLRank>(`SELECT p.player_id AS id,p.player_name AS name,p.team_id AS teamId,
      t.team_name AS teamName,p.connected,p.total_score AS totalScore,
      COUNT(r.result_id) AS completed,COALESCE(SUM(r.win_or_lose='win'),0) AS wins,
      COALESCE(SUM(r.win_or_lose='lose'),0) AS losses,COALESCE(SUM(r.duration),0) AS duration,
      SUM(CASE WHEN gs.team_id IS NULL THEN COALESCE((r.awarded_units+r.adjustment_units)*r.score_weight,0) ELSE 0 END) AS soloUnits,
      SUM(CASE WHEN gs.team_id IS NOT NULL THEN (r.awarded_units+r.adjustment_units)*r.score_weight ELSE 0 END) AS multiUnits
      FROM players p JOIN teams t USING(team_id)
      LEFT JOIN official_results o ON o.player_id=p.player_id AND o.competition_id=?
      LEFT JOIN game_results r USING(result_id) LEFT JOIN game_sessions gs ON gs.session_id=r.session_id
      GROUP BY p.player_id ORDER BY p.created_at,p.player_id`, this.competitionId)
      .sort((a,b) => b.totalScore - a.totalScore || order(a,b))
      .map(({ soloUnits, multiUnits, ...player }, index): PlayerRank => ({
        ...player, rank: index + 1, connected: Boolean(player.connected), soloScore: soloUnits / SCORE_SCALE, multiScore: multiUnits / SCORE_SCALE
      }));
    const teams = this.all<TeamRow>("SELECT * FROM teams ORDER BY team_id").map((team): TeamRank => {
      const members = players.filter(player => player.teamId === team.team_id);
      return {
        id: team.team_id, name: team.team_name, rank: 0, members,
        score: members.reduce((sum, player) => sum + Math.round(player.totalScore * SCORE_SCALE), 0) / (TEAM_SIZE * SCORE_SCALE),
        completed: members.reduce((sum, player) => sum + player.completed, 0),
        wins: members.reduce((sum, player) => sum + player.wins, 0),
        duration: members.reduce((sum, player) => sum + player.duration, 0)
      };
    }).sort((a,b) => b.score - a.score || order(a,b));
    teams.forEach((team, index) => { team.rank = index + 1; });
    return { players, teams };
  }

  audit(action: string, detail: string, now: number) {
    this.run("INSERT INTO audit_log(action,detail,created_at) VALUES (?,?,?)", action, detail, now);
  }
  resetCompetition(now: number, action = "competition.reset") {
    this.competitionId = this.transaction(() => {
      this.run("UPDATE competitions SET closed_at=? WHERE id=?", now, this.competitionId);
      this.run(`UPDATE game_sessions SET status='cancelled',reason='reset',ended_at=? WHERE competition_id=?
        AND status IN ('lobby','countdown','running')`, now, this.competitionId);
      this.run("DELETE FROM station_queue");
      this.run("UPDATE players SET score_units=0");
      const next = this.createCompetition(now);
      this.audit(action, this.competitionId + " → " + next, now);
      return next;
    });
  }
  close() { this.db.close(); }
}

