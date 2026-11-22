import { fixedId } from "../../../packages/shared/catalog";
import { FLOORS, floorPlanFrame, originalFloorStations, originalPhotoSize } from "../../../packages/shared/floors";
import { DEFAULT_DOUBLE_CHANCE, DOUBLE_START_MS, DOUBLE_END_MS } from "../../../packages/shared/rules";
import { LEGACY_ROUTE_LENGTH, LEGACY_TIER_SIZE, ROUTE_LENGTH } from "../../../packages/shared/route";

export const migrations = [{
  version: 1,
  sql: `
CREATE TABLE competitions (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
) STRICT;

CREATE TABLE teams (
  team_id TEXT PRIMARY KEY,
  team_name TEXT NOT NULL UNIQUE,
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count BETWEEN 0 AND 5)
) STRICT;

CREATE TABLE players (
  player_id TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  token_hash TEXT UNIQUE,
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  connected INTEGER NOT NULL DEFAULT 0 CHECK (connected IN (0, 1)),
  total_score_units INTEGER NOT NULL DEFAULT 0 CHECK (total_score_units BETWEEN 0 AND 200),
  total_score REAL GENERATED ALWAYS AS (total_score_units / 5.0) VIRTUAL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX players_team ON players(team_id);
CREATE TRIGGER player_added AFTER INSERT ON players
BEGIN
  UPDATE teams SET member_count = member_count + 1 WHERE team_id = NEW.team_id;
END;

CREATE TABLE games (
  game_id TEXT PRIMARY KEY,
  game_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('puzzle', 'adventure', 'math')),
  mode TEXT NOT NULL CHECK (mode IN ('solo', 'co-op', 'team-quiz')),
  time_limit INTEGER NOT NULL CHECK (time_limit = 60),
  plugin_path TEXT NOT NULL,
  win_condition TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
) STRICT;

CREATE TABLE hosts (
  host_id TEXT PRIMARY KEY,
  station_id TEXT UNIQUE REFERENCES campus_stations(station_id),
  assigned_game_id TEXT NOT NULL REFERENCES games(game_id),
  connection_status INTEGER NOT NULL DEFAULT 0 CHECK (connection_status IN (0, 1))
) STRICT;
CREATE TABLE campus_stations (
  station_id TEXT PRIMARY KEY,
  station_name TEXT NOT NULL,
  position_x REAL NOT NULL CHECK (position_x BETWEEN 0 AND 100),
  position_y REAL NOT NULL CHECK (position_y BETWEEN 0 AND 100),
  assigned_host_id TEXT UNIQUE REFERENCES hosts(host_id),
  open INTEGER NOT NULL DEFAULT 1 CHECK (open IN (0, 1))
) STRICT;

CREATE TABLE game_rounds (
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  game_id TEXT NOT NULL REFERENCES games(game_id),
  round_no INTEGER NOT NULL CHECK (round_no >= 1),
  PRIMARY KEY (competition_id, game_id)
) STRICT;

CREATE TABLE game_sessions (
  session_id TEXT PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  game_id TEXT NOT NULL REFERENCES games(game_id),
  station_id TEXT NOT NULL REFERENCES campus_stations(station_id),
  host_id TEXT NOT NULL REFERENCES hosts(host_id),
  team_id TEXT REFERENCES teams(team_id),
  round_no INTEGER NOT NULL CHECK (round_no >= 1),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  deadline INTEGER,
  ended_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('lobby', 'countdown', 'running', 'finished', 'cancelled')),
  reason TEXT,
  seed INTEGER NOT NULL,
  engine_state TEXT,
  roster TEXT NOT NULL DEFAULT '[]'
) STRICT;
CREATE UNIQUE INDEX one_live_session_per_station ON game_sessions(station_id)
  WHERE status IN ('lobby', 'countdown', 'running');
CREATE UNIQUE INDEX one_live_team_room ON game_sessions(team_id)
  WHERE team_id IS NOT NULL AND status IN ('lobby', 'countdown', 'running');

CREATE TABLE session_members (
  session_id TEXT NOT NULL REFERENCES game_sessions(session_id),
  player_id TEXT NOT NULL REFERENCES players(player_id),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),
  participated INTEGER NOT NULL DEFAULT 0 CHECK (participated IN (0, 1)),
  forfeited INTEGER NOT NULL DEFAULT 0 CHECK (forfeited IN (0, 1)),
  last_seq INTEGER NOT NULL DEFAULT 0,
  won_at INTEGER,
  PRIMARY KEY (session_id, player_id)
) STRICT;

CREATE TABLE station_queue (
  ticket INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id TEXT NOT NULL REFERENCES campus_stations(station_id),
  player_id TEXT NOT NULL UNIQUE REFERENCES players(player_id),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX queue_station ON station_queue(station_id, ticket);

CREATE TABLE game_results (
  result_id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES game_sessions(session_id),
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  player_id TEXT NOT NULL REFERENCES players(player_id),
  game_id TEXT NOT NULL REFERENCES games(game_id),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  round_no INTEGER NOT NULL,
  participated INTEGER NOT NULL CHECK (participated IN (0, 1)),
  win_or_lose TEXT NOT NULL CHECK (win_or_lose IN ('win', 'lose', 'absent')),
  raw_points INTEGER NOT NULL CHECK (raw_points BETWEEN 0 AND 2),
  awarded_units INTEGER NOT NULL CHECK (awarded_units BETWEEN 0 AND 10),
  awarded_points REAL GENERATED ALWAYS AS (awarded_units / 5.0) VIRTUAL,
  duration INTEGER NOT NULL CHECK (duration BETWEEN 0 AND 60000),
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, player_id),
  CHECK ((participated = 0 AND win_or_lose = 'absent' AND raw_points = 0 AND awarded_units = 0)
    OR (participated = 1 AND ((win_or_lose = 'win' AND raw_points = 2) OR (win_or_lose = 'lose' AND raw_points = 1))))
) STRICT;
CREATE UNIQUE INDEX one_result_per_round ON game_results (competition_id, player_id, game_id, round_no)
  WHERE participated = 1;

CREATE TABLE official_results (
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  player_id TEXT NOT NULL REFERENCES players(player_id),
  game_id TEXT NOT NULL REFERENCES games(game_id),
  result_id INTEGER NOT NULL UNIQUE REFERENCES game_results(result_id),
  PRIMARY KEY (competition_id, player_id, game_id)
) STRICT;

CREATE TABLE team_results (
  team_result_id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES game_sessions(session_id),
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  game_id TEXT NOT NULL REFERENCES games(game_id),
  round_no INTEGER NOT NULL,
  total_raw_points INTEGER NOT NULL CHECK (total_raw_points BETWEEN 1 AND 10),
  team_average_points REAL GENERATED ALWAYS AS (total_raw_points / 5.0) VIRTUAL,
  created_at INTEGER NOT NULL,
  UNIQUE (competition_id, team_id, game_id, round_no)
) STRICT;

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  map_revision INTEGER NOT NULL DEFAULT 0,
  map_mime TEXT,
  map_data BLOB
) STRICT;
INSERT INTO settings(id) VALUES (1);
`
}, {
  version: 2,
  sql: "ALTER TABLE game_results ADD COLUMN metrics TEXT NOT NULL DEFAULT '{}';"
}, {
  version: 3,
  sql: `
ALTER TABLE campus_stations ADD COLUMN floor INTEGER NOT NULL DEFAULT 3 CHECK (floor IN (3, 4));
${originalFloorStations.map(([floor, name, x, y], index) =>
  `UPDATE campus_stations SET floor=${floor},station_name='${name.replaceAll("'", "''")}',position_x=${x},position_y=${y}
    WHERE station_id='${fixedId("STATION", index + 1)}';`
).join("\n")}

CREATE TABLE floor_maps (
  floor INTEGER PRIMARY KEY CHECK (floor IN (3, 4)),
  revision INTEGER NOT NULL DEFAULT 0,
  mime TEXT,
  image BLOB
) STRICT;
INSERT INTO floor_maps(floor) VALUES (3), (4);
ALTER TABLE settings ADD COLUMN double_chance INTEGER NOT NULL DEFAULT ${DEFAULT_DOUBLE_CHANCE} CHECK (double_chance BETWEEN 0 AND 100);

ALTER TABLE game_sessions ADD COLUMN double_due_at INTEGER;
ALTER TABLE game_sessions ADD COLUMN double_player_id TEXT REFERENCES players(player_id);
ALTER TABLE game_sessions ADD COLUMN double_started_at INTEGER;

ALTER TABLE game_results ADD COLUMN adjustment_units INTEGER NOT NULL DEFAULT 0
  CHECK (adjustment_units = 0 OR adjustment_units = CASE win_or_lose
    WHEN 'win' THEN awarded_units WHEN 'lose' THEN -3 * awarded_units ELSE 0 END);
ALTER TABLE game_results DROP COLUMN awarded_points;
ALTER TABLE game_results ADD COLUMN awarded_points REAL GENERATED ALWAYS AS ((awarded_units + adjustment_units) / 5.0) VIRTUAL;
ALTER TABLE players ADD COLUMN score_adjustment_units INTEGER NOT NULL DEFAULT 0 CHECK (score_adjustment_units BETWEEN -600 AND 200);
ALTER TABLE players DROP COLUMN total_score;
ALTER TABLE players ADD COLUMN total_score REAL GENERATED ALWAYS AS ((total_score_units + score_adjustment_units) / 5.0) VIRTUAL;
`
}, {
  version: 4,
  sql: FLOORS.map(floor => {
    const frame = floorPlanFrame[floor];
    const photo = originalPhotoSize[floor];
    return `UPDATE campus_stations SET
      position_x=ROUND(MAX(0,MIN(100,(position_x*${photo.width}/100.0-${frame.x})*100.0/${frame.width})),2),
      position_y=ROUND(MAX(0,MIN(100,(position_y*${photo.height}/100.0-${frame.y})*100.0/${frame.height})),2)
      WHERE floor=${floor} AND EXISTS (SELECT 1 FROM floor_maps WHERE floor=${floor} AND image IS NULL);`;
  }).join("\n")
}, {
  version: 5,
  sql: `
ALTER TABLE competitions ADD COLUMN play_format TEXT NOT NULL DEFAULT 'legacy' CHECK (play_format IN ('legacy','individual'));
CREATE TABLE player_routes (
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  player_id TEXT NOT NULL REFERENCES players(player_id),
  step INTEGER NOT NULL CHECK (step BETWEEN 1 AND ${LEGACY_ROUTE_LENGTH}),
  game_id TEXT NOT NULL REFERENCES games(game_id),
  seed INTEGER NOT NULL,
  double_offset INTEGER CHECK (double_offset = -1 OR double_offset BETWEEN ${DOUBLE_START_MS} AND ${DOUBLE_END_MS}),
  PRIMARY KEY (competition_id, player_id, step),
  UNIQUE (competition_id, player_id, game_id),
  UNIQUE (competition_id, game_id, seed)
) STRICT;
CREATE INDEX route_first_rooms ON player_routes(competition_id, step, game_id);
ALTER TABLE game_sessions ADD COLUMN route_step INTEGER NOT NULL DEFAULT 0 CHECK (route_step BETWEEN 0 AND ${LEGACY_ROUTE_LENGTH});
ALTER TABLE session_members ADD COLUMN played INTEGER NOT NULL DEFAULT 0 CHECK (played IN (0,1));
ALTER TABLE game_results ADD COLUMN route_step INTEGER NOT NULL DEFAULT 0 CHECK (route_step BETWEEN 0 AND ${LEGACY_ROUTE_LENGTH});
CREATE UNIQUE INDEX one_result_per_route_step ON game_results (competition_id, player_id, route_step)
  WHERE participated = 1 AND route_step > 0;
ALTER TABLE game_results ADD COLUMN score_weight INTEGER GENERATED ALWAYS AS (
  CASE WHEN route_step=0 THEN 1 ELSE 1+(route_step-1)/${LEGACY_TIER_SIZE} END
) VIRTUAL;
ALTER TABLE game_results DROP COLUMN awarded_points;
ALTER TABLE game_results ADD COLUMN awarded_points REAL GENERATED ALWAYS AS
  ((awarded_units + adjustment_units) * score_weight / 5.0) VIRTUAL;

ALTER TABLE players ADD COLUMN score_units INTEGER NOT NULL DEFAULT 0;
UPDATE players SET score_units=total_score_units+score_adjustment_units;
ALTER TABLE players DROP COLUMN total_score;
ALTER TABLE players DROP COLUMN total_score_units;
ALTER TABLE players DROP COLUMN score_adjustment_units;
ALTER TABLE players ADD COLUMN total_score REAL GENERATED ALWAYS AS (score_units / 5.0) VIRTUAL;

WITH numbered AS (
  SELECT host_id,station_id,ROW_NUMBER() OVER(PARTITION BY assigned_game_id ORDER BY station_id) AS copy FROM hosts
), extras AS (
  SELECT host_id,ROW_NUMBER() OVER(ORDER BY station_id) AS n FROM numbered WHERE copy>1
), unused AS (
  SELECT game_id,ROW_NUMBER() OVER(ORDER BY game_id) AS n FROM games
  WHERE game_id NOT IN(SELECT assigned_game_id FROM hosts)
)
UPDATE hosts SET assigned_game_id=(SELECT unused.game_id FROM extras JOIN unused USING(n) WHERE extras.host_id=hosts.host_id)
WHERE host_id IN(SELECT host_id FROM extras);
`
}, {
  version: 6,
  sql: `
CREATE TABLE match_search (
  player_id TEXT PRIMARY KEY REFERENCES players(player_id),
  queued_at INTEGER NOT NULL
) STRICT;
ALTER TABLE game_sessions ADD COLUMN match_tier INTEGER NOT NULL DEFAULT 0 CHECK (match_tier BETWEEN 0 AND 4);
ALTER TABLE game_sessions ADD COLUMN winner_side INTEGER CHECK (winner_side BETWEEN 0 AND 2);
ALTER TABLE session_members ADD COLUMN checked_in INTEGER NOT NULL DEFAULT 0 CHECK (checked_in IN (0,1));
ALTER TABLE session_members ADD COLUMN side INTEGER CHECK (side BETWEEN 0 AND 2);
ALTER TABLE session_members ADD COLUMN route_step INTEGER NOT NULL DEFAULT 0 CHECK (route_step BETWEEN 0 AND ${ROUTE_LENGTH});
ALTER TABLE game_results ADD COLUMN match_weight INTEGER NOT NULL DEFAULT 0 CHECK (match_weight BETWEEN 0 AND 4);
ALTER TABLE game_results DROP COLUMN awarded_points;
ALTER TABLE game_results DROP COLUMN score_weight;
ALTER TABLE game_results ADD COLUMN score_weight INTEGER GENERATED ALWAYS AS (
  CASE WHEN match_weight>0 THEN match_weight WHEN route_step=0 THEN 1 ELSE 1+(route_step-1)/${LEGACY_TIER_SIZE} END
) VIRTUAL;
ALTER TABLE game_results ADD COLUMN awarded_points REAL GENERATED ALWAYS AS
  ((awarded_units + adjustment_units) * score_weight / 5.0) VIRTUAL;

UPDATE game_sessions SET status='cancelled', reason='reset',
  ended_at=COALESCE(ended_at, CAST(unixepoch('subsec') * 1000 AS INTEGER))
WHERE status IN ('lobby','countdown','running');
DELETE FROM station_queue;
`
}, {
  version: 7,
  sql: `
ALTER TABLE match_search ADD COLUMN assisting INTEGER NOT NULL DEFAULT 0 CHECK (assisting IN (0,1));
ALTER TABLE game_sessions ADD COLUMN paused_at INTEGER;
ALTER TABLE game_sessions ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0 CHECK (paused_ms >= 0);
ALTER TABLE game_sessions ADD COLUMN clock_at INTEGER;
ALTER TABLE game_sessions ADD COLUMN voided_at INTEGER;
ALTER TABLE game_results ADD COLUMN assisting INTEGER NOT NULL DEFAULT 0 CHECK (assisting IN (0,1));
ALTER TABLE game_results ADD COLUMN tied INTEGER NOT NULL DEFAULT 0 CHECK (tied IN (0,1));
ALTER TABLE game_results ADD COLUMN voided_at INTEGER;

DROP INDEX one_result_per_round;
CREATE UNIQUE INDEX one_result_per_round ON game_results(competition_id,player_id,game_id,round_no)
  WHERE participated=1 AND assisting=0 AND voided_at IS NULL;
DROP INDEX one_result_per_route_step;
CREATE UNIQUE INDEX one_result_per_route_step ON game_results(competition_id,player_id,route_step)
  WHERE participated=1 AND route_step>0 AND voided_at IS NULL;
UPDATE game_results SET tied=1 WHERE participated=1 AND session_id IN (
  SELECT session_id FROM game_sessions WHERE match_tier>0 AND winner_side IS NULL
);

UPDATE game_results AS result SET metrics=json_remove(json_set(metrics,'$.sideAnswers',json_object(
  'attempted',json_extract(metrics,'$.attempted'),'correct',json_extract(metrics,'$.correct')
)), '$.attempted', '$.correct')
WHERE json_valid(metrics) AND json_type(metrics,'$.attempted')='integer'
  AND EXISTS (SELECT 1 FROM session_members member JOIN session_members teammate
    ON teammate.session_id=member.session_id AND teammate.side=member.side AND teammate.player_id<>member.player_id
    WHERE member.session_id=result.session_id AND member.player_id=result.player_id);
`
}, {
  version: 8,
  sql: `
ALTER TABLE players ADD COLUMN student_no TEXT;
ALTER TABLE players ADD COLUMN access_hash TEXT;
ALTER TABLE players ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0,1));
CREATE UNIQUE INDEX unique_student_number ON players(student_no) WHERE student_no IS NOT NULL;
ALTER TABLE settings ADD COLUMN self_registration INTEGER NOT NULL DEFAULT 1 CHECK (self_registration IN (0,1));
ALTER TABLE competitions ADD COLUMN reset_reason TEXT;
CREATE TABLE competition_rosters (
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  player_id TEXT NOT NULL REFERENCES players(player_id),
  player_name TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (competition_id, player_id)
) STRICT;
`
}, {
  version: 9,
  sql: `
INSERT INTO games(game_id,game_name,category,mode,time_limit,plugin_path,win_condition)
  VALUES ('game-21','史萊姆排球','adventure','solo',60,'local-games/game-21','限時內球場得分較高的一方獲勝')
  ON CONFLICT(game_id) DO NOTHING;
UPDATE hosts SET assigned_game_id='game-21' WHERE assigned_game_id='game-19';
UPDATE games SET enabled=0 WHERE game_id='game-19';

INSERT OR IGNORE INTO match_search(player_id,queued_at,assisting)
  SELECT m.player_id, s.created_at, m.route_step=0
  FROM game_sessions s JOIN session_members m USING(session_id) JOIN players p USING(player_id)
  JOIN competitions c ON c.id=s.competition_id
  WHERE s.game_id='game-19' AND s.status IN ('lobby','countdown','running') AND c.closed_at IS NULL
    AND m.checked_in=1 AND m.forfeited=0 AND p.suspended=0;
UPDATE game_sessions SET status='cancelled',reason='reset',
  ended_at=COALESCE(ended_at,CAST(unixepoch('subsec') * 1000 AS INTEGER))
  WHERE game_id='game-19' AND status IN ('lobby','countdown','running');
`
}];

