import { GAME_MS, SCORE_SCALE } from "../../../packages/shared/catalog";
import { DOUBLE_FACTOR } from "../../../packages/shared/rules";
import type { EndReason, ResultMetrics } from "../../../packages/shared/protocol";
import type { SessionRow, Store } from "./store";

export interface Outcome {
  playerId: string;
  teamId: string;
  participated: boolean;
  won: boolean;
  duration: number;
  metrics?: ResultMetrics;
}

export function settle(store: Store, session: SessionRow, outcomes: Outcome[], reason: EndReason, endedAt: number) {
  return store.transaction(() => {
    const change = store.run(`UPDATE game_sessions SET status='finished',ended_at=?,reason=?
      WHERE session_id=? AND status='running'`, endedAt, reason, session.session_id);
    if (Number(change.changes) === 0) return false;
    const raw = outcomes.map(outcome => outcome.participated ? (outcome.won ? 2 : 1) : 0);
    const rawTotal = raw.reduce<number>((sum, points) => sum + points, 0);
    if (session.team_id) {
      store.run(`INSERT INTO team_results(session_id,competition_id,team_id,game_id,round_no,total_raw_points,created_at)
        VALUES (?,?,?,?,?,?,?)`, session.session_id, session.competition_id, session.team_id, session.game_id,
        session.round_no, rawTotal, endedAt);
    }
    outcomes.forEach((outcome, index) => {
      const baseUnits = outcome.participated ? (session.team_id ? rawTotal : raw[index] * SCORE_SCALE) : 0;
      const doubled = outcome.participated && session.double_player_id === outcome.playerId
        && session.double_started_at != null && session.double_started_at <= endedAt;
      const awardUnits = doubled ? baseUnits * DOUBLE_FACTOR * (outcome.won ? 1 : -1) : baseUnits;
      const result = store.run(`INSERT INTO game_results(session_id,competition_id,player_id,game_id,team_id,round_no,
        participated,win_or_lose,raw_points,awarded_units,adjustment_units,duration,created_at,metrics,route_step)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, session.session_id, session.competition_id, outcome.playerId,
        session.game_id, outcome.teamId, session.round_no, Number(outcome.participated),
        outcome.participated ? (outcome.won ? "win" : "lose") : "absent", raw[index],
        baseUnits, awardUnits - baseUnits,
        Math.max(0, Math.min(GAME_MS, Math.trunc(outcome.duration))), endedAt, JSON.stringify(outcome.metrics ?? {}), session.route_step ?? 0);
      if (!outcome.participated) return;
      store.run(`INSERT INTO official_results(competition_id,player_id,game_id,result_id) VALUES (?,?,?,?)
        ON CONFLICT(competition_id,player_id,game_id) DO UPDATE SET result_id=excluded.result_id`,
        session.competition_id, outcome.playerId, session.game_id, result.lastInsertRowid);
      store.run(`UPDATE players SET score_units=(SELECT
        COALESCE(SUM((r.awarded_units+r.adjustment_units)*r.score_weight),0)
        FROM official_results o JOIN game_results r USING(result_id) WHERE o.player_id=? AND o.competition_id=?)
        WHERE player_id=?`, outcome.playerId, session.competition_id, outcome.playerId);
    });
    return true;
  });
}

