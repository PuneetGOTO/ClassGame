import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { GAMES } from "../packages/shared/catalog";
import { settle, type Outcome } from "../apps/server/src/scoring";
import { Store, type SessionRow } from "../apps/server/src/store";

function game(store: Store, gameId: string, team: boolean, round = 1, step = 0) {
  const row: SessionRow = {
    session_id: randomUUID(), game_id: gameId, team_id: team ? "TEAM-01" : null, round_no: round, competition_id: store.competitionId,
    station_id: "STATION-01", host_id: "HOST-01", created_at: 0, started_at: 3000, deadline: 63000,
    ended_at: null, status: "running", reason: null, seed: 1, engine_state: null, roster: "[]",
    double_due_at: null, double_player_id: null, double_started_at: null, route_step: step
  };
  store.run(`INSERT INTO game_sessions(session_id,game_id,team_id,round_no,competition_id,station_id,host_id,
    created_at,started_at,deadline,status,seed,route_step) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    row.session_id, row.game_id, row.team_id, row.round_no, row.competition_id, row.station_id, row.host_id, 0, 3000, 63000, row.status, 1, step);
  return row;
}

test("solo scoring, partial attendance, mixed team result and ledger idempotency", () => {
  const db = new Store(":memory:", 0);
  try {
    const players = Array.from({ length: 5 }, (_, i) => db.addPlayer("隊員 " + (i + 1), undefined, i).id);
    const outcomes = (results: ("win"|"lose"|"absent")[]): Outcome[] => results.map((result, index) => ({
      playerId: players[index], teamId: "TEAM-01", participated: result !== "absent", won: result === "win", duration: 100
    }));
    assert.deepEqual(players.map(id => db.player(id)!.total_score), [0, 0, 0, 0, 0]);
    assert.equal(settle(db, game(db, "game-01", false), outcomes(["win"]), "goal", 3100), true);
    settle(db, game(db, "game-01", false), outcomes(["absent", "lose"]), "timeout", 63000);
    assert.deepEqual(players.map(id => db.player(id)!.total_score), [2, 1, 0, 0, 0]);

    const mixed = game(db, "game-18", true);
    const results = outcomes(["win", "win", "lose", "win", "lose"]);
    assert.equal(settle(db, mixed, results, "goal", 3200), true);
    assert.equal(settle(db, mixed, results, "goal", 3200), false);
    assert.equal(db.teamResult(mixed.session_id)?.average, 1.6);
    assert.deepEqual(db.resultsForSession(mixed.session_id).map(result => [result.rawPoints, result.awarded]),
      [[2,1.6], [2,1.6], [1,1.6], [2,1.6], [1,1.6]]);

    const partial = game(db, "game-19", true);
    settle(db, partial, outcomes(["win", "lose", "absent", "absent", "absent"]), "timeout", 63000);
    assert.equal(db.teamResult(partial.session_id)?.average, 0.6);
    assert.deepEqual(db.resultsForSession(partial.session_id).map(result => result.awarded), [0.6, 0.6, 0, 0, 0]);
    assert.deepEqual(players.map(id => db.player(id)!.total_score), [4.2, 3.2, 1.6, 1.6, 1.6]);
    assert.equal(db.leaderboard().teams[0].score, 2.44);

    assert.equal(db.reopen("game-01", 70000), 2);
    settle(db, game(db, "game-01", false, 2), outcomes(["lose"]), "timeout", 63000);
    assert.equal(db.player(players[0])!.total_score, 3.2);
    assert.equal(db.officialFor(players[0]).find(row => row.gameId === "game-01")!.round, 2);
    const original = db.competitionId;
    db.resetCompetition(80000);
    assert.equal(db.player(players[0])!.total_score, 0);
    assert.equal(db.officialFor(players[0]).length, 0);
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM game_results WHERE competition_id=?", original)!.n, 14);
  } finally { db.close(); }
});

test("base scores for ten matches total 50 for wins and 25 for losses", () => {
  const db = new Store(":memory:", 0);
  try {
    const players = Array.from({ length: 5 }, (_, i) => ({
      playerId: db.addPlayer("全部獲勝 " + i, undefined, i).id, teamId: "TEAM-01", participated: true, won: true, duration: 250
    }));
    for (const player of players) {
      for (const [index, gameInfo] of GAMES.slice(0, 10).entries()) {
        const step = index + 1;
        const row = game(db, gameInfo.id, false, 1, step);
        assert.equal(settle(db, row, [{ ...player, step }], "goal", 3250), true);
        assert.equal(settle(db, row, [{ ...player, step }], "goal", 3250), false);
      }
    }
    assert.deepEqual(db.leaderboard().players.map(player => [player.completed, player.wins, player.totalScore]), Array(5).fill([10,10,50]));
    assert.equal(db.leaderboard().teams[0].score, 50);
    db.resetCompetition(70000);
    const losses = players.map(player => ({ ...player, won: false, duration: 60_000 }));
    for (const player of losses) {
      for (const [index, gameInfo] of GAMES.slice(0, 10).entries()) {
        const step = index + 1;
        settle(db, game(db, gameInfo.id, false, 1, step), [{ ...player, step }], "timeout", 63000);
      }
    }
    assert.deepEqual(db.leaderboard().players.map(player => [player.completed, player.losses, player.totalScore]), Array(5).fill([10,10,25]));
    assert.equal(db.leaderboard().teams[0].score, 25);
  } finally { db.close(); }
});

