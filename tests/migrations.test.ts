import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrations } from "../apps/server/src/migrations";
import { Store } from "../apps/server/src/store";
import { AIR_HOCKEY_ID, CROSS_ROAD_ID, NUMBER_HUNT_ID, VOLLEYBALL_ID } from "../packages/shared/catalog";
import { planPosition } from "../packages/shared/floors";

test("upgrading a version-one database preserves its identity and initializes result metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(),"campus-migration-"));
  const path = join(directory,"game.sqlite");
  try {
    const previous = new DatabaseSync(path);
    try {
      previous.exec(migrations[0].sql);
      previous.exec(`PRAGMA user_version=1;
        INSERT INTO competitions(id,created_at) VALUES (1,10);
        INSERT INTO teams(team_id,team_name) VALUES ('TEAM-01','第 1 隊');
        INSERT INTO games(game_id,game_name,category,mode,time_limit,plugin_path,win_condition)
          VALUES ('game-01','推箱子','puzzle','solo',60,'local-games/game-01','完成');
        INSERT INTO campus_stations(station_id,station_name,position_x,position_y) VALUES ('STATION-01','北門廣場',13,19);
        INSERT INTO hosts(host_id,station_id,assigned_game_id) VALUES ('HOST-01','STATION-01','game-01');
        INSERT INTO players(player_id,player_name,name_key,team_id,total_score_units,created_at) VALUES ('player','舊資料','舊資料','TEAM-01',10,10);
        INSERT INTO game_sessions(session_id,competition_id,game_id,station_id,host_id,round_no,created_at,ended_at,status,seed)
          VALUES ('result',1,'game-01','STATION-01','HOST-01',1,10,100,'finished',1);
        INSERT INTO game_results(result_id,session_id,competition_id,player_id,game_id,team_id,round_no,participated,win_or_lose,
          raw_points,awarded_units,duration,created_at) VALUES (1,'result',1,'player','game-01','TEAM-01',1,1,'win',2,10,60,100);
        INSERT INTO official_results VALUES (1,'player','game-01',1);`);
      previous.prepare("UPDATE campus_stations SET assigned_host_id=? WHERE station_id=?").run("HOST-01","STATION-01");
    } finally { previous.close(); }
    const store = new Store(path, 1000);
    try {
      assert.equal(store.competitionId,2);
      assert.equal(store.player("player")!.total_score,0);
      assert.equal(store.officialFor("player").length,0);
      const [archived] = store.officialFor("player",1);
      assert.equal(archived.outcome,"win");
      assert.equal(archived.doublePoints,false);
      assert.equal(archived.baseAwarded,2);
      assert.deepEqual(archived.metrics,{});
      assert.deepEqual(store.playedGames("player"),[]);
      assert.equal(store.get<{ user_version: number }>("PRAGMA user_version")!.user_version,10);
      assert.equal(store.player("player")?.student_no,null);
      assert.equal(store.selfRegistration(),true);
      const stations = store.stationRows();
      assert.equal(stations.filter(station => station.floor === 3).length,10);
      assert.equal(stations.filter(station => station.floor === 4).length,10);
      assert.equal(stations[0].name,"301 室");
      assert.deepEqual([stations[0].x,stations[0].y],planPosition(3,83.6,26.6));
      assert.equal(stations[10].name,"401 室");
      assert.equal(store.doubleChance(),20);
      assert.equal(store.get("PRAGMA foreign_key_check"),undefined);
    } finally { store.close(); }
  } finally { await rm(directory,{ recursive: true,force: true }); }
});

for (const { priorVersion, retired, replacement, host, station, name } of [
  { priorVersion: 8, retired: NUMBER_HUNT_ID, replacement: VOLLEYBALL_ID, host: "HOST-19", station: "STATION-19", name: "數字推理" },
  { priorVersion: 9, retired: CROSS_ROAD_ID, replacement: AIR_HOCKEY_ID, host: "HOST-07", station: "STATION-07", name: "穿越馬路" }
]) test("station migration preserves official points for " + name, async () => {
  const directory = await mkdtemp(join(tmpdir(), "campus-retire-game-"));
  const path = join(directory, "game.sqlite");
  try {
    const old = new Store(path, 1000);
    const player = old.addPlayer("舊關卡玩家", undefined, 1000).id;
    const edition = old.competitionId;
    try {
      old.run("INSERT INTO games(game_id,game_name,category,mode,time_limit,plugin_path,win_condition) VALUES (?,?, 'adventure','solo',60,?,?)",
        retired, name, "local-games/" + retired, "完成目標");
      old.run("UPDATE hosts SET assigned_game_id=? WHERE host_id=?", retired, host);
      old.run("DELETE FROM games WHERE game_id=?", replacement);
      old.run(`INSERT INTO game_sessions(session_id,competition_id,game_id,station_id,host_id,round_no,created_at,ended_at,status,seed,match_tier)
        VALUES ('retired-result',?,?,?,?,1,10,100,'finished',1,1),
          ('retired-wait',?,?,?,?,1,200,NULL,'lobby',1,1)`, edition, retired, station, host, edition, retired, station, host);
      old.run(`INSERT INTO game_results(result_id,session_id,competition_id,player_id,game_id,team_id,round_no,participated,
        win_or_lose,raw_points,awarded_units,duration,created_at,route_step,match_weight)
        VALUES (1,'retired-result',?,?,?,'TEAM-01',1,1,'win',2,10,90,100,1,1)`, edition, player, retired);
      old.run("INSERT INTO official_results VALUES (?,?,?,1)", edition, player, retired);
      old.run("INSERT INTO session_members(session_id,player_id,team_id,checked_in,route_step) VALUES ('retired-wait',?,'TEAM-01',1,2)", player);
      old.refreshPlayerScore(player, edition);
      old.db.exec("PRAGMA user_version=" + priorVersion);
    } finally { old.close(); }

    const upgraded = new Store(path, 2000);
    try {
      assert.equal(upgraded.competitionId, edition);
      assert.equal(upgraded.stationRows().find(item => item.hostId === host)?.gameId, replacement);
      assert.equal(upgraded.get<{ enabled: number }>("SELECT enabled FROM games WHERE game_id=?", retired)?.enabled, 0);
      assert.equal(upgraded.get<{ count: number }>("SELECT COUNT(*) AS count FROM games WHERE enabled=1")?.count, 20);
      assert.equal(upgraded.get<{ status: string }>("SELECT status FROM game_sessions WHERE session_id='retired-wait'")?.status, "cancelled");
      assert.equal(upgraded.get<{ player_id: string }>("SELECT player_id FROM match_search")?.player_id, player);
      assert.equal(upgraded.officialFor(player)[0]?.gameId, retired);
      assert.equal(upgraded.leaderboard().players[0]?.totalScore, 2);
      assert.equal(upgraded.get("PRAGMA foreign_key_check"), undefined);
    } finally { upgraded.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

