import { z } from "zod";
import type { GameInfo } from "./catalog";
import type { Floor } from "./floors";
import type { Difficulty, MatchMode } from "./route";
import type { PracticeRole, PracticeView } from "./practice";

export const keySchema = z.string().min(16).max(150);
export const nameSchema = z.string().trim().min(1).max(24).regex(/^[^\p{C}]+$/u, "名稱不可包含控制字元");
export const teamIdSchema = z.string().regex(/^TEAM-(0[1-9]|10)$/);
export const hostIdSchema = z.string().regex(/^HOST-(0[1-9]|1[0-9]|20)$/);
export const stationIdSchema = z.string().regex(/^STATION-(0[1-9]|1[0-9]|20)$/);
export const stationQrSchema = z.string().regex(/^\d{1,16}\.[A-Za-z0-9_-]{32}$/);
export const floorSchema = z.union([z.literal(3), z.literal(4)]);
export const sessionIdSchema = z.uuid();
export const registrationSchema = z.object({ name: nameSchema, teamId: teamIdSchema.optional() });
export const studentNumberSchema = z.string().max(64).transform(value => value.normalize("NFKC").trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9._-]{1,23}$/, "請輸入 2 至 24 個英數字、點、底線或連字號"));
export const studentLoginSchema = z.object({ studentNumber: studentNumberSchema, code: z.string().trim().regex(/^\d{8}$/) });
export const directionSchema = z.enum(["up", "down", "left", "right"]);

export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), direction: directionSchema }),
  z.object({ kind: z.literal("cursor"), direction: directionSchema }),
  z.object({ kind: z.literal("choice"), questionId: z.number().int().positive(), index: z.number().int().min(0).max(3) }),
  z.object({ kind: z.literal("cell"), index: z.number().int().min(0).max(2_000) }),
  z.object({ kind: z.literal("action"), action: z.enum(["shoot", "jump", "duck", "interact"]) }),
  z.object({ kind: z.literal("answer"), questionId: z.number().int().nonnegative(), value: z.string().trim().min(1).max(64) })
]);
export const inputSchema = z.object({
  sessionId: sessionIdSchema,
  seq: z.number().int().positive().max(2_147_483_647),
  action: actionSchema
});
export type Action = z.infer<typeof actionSchema>;
export type Direction = z.infer<typeof directionSchema>;
export type Ack<T = null> = { ok: true; data: T } | { ok: false; error: string; code: string };
export type RoomStatus = "lobby" | "countdown" | "running" | "finished" | "cancelled";
export type MatchEndReason = "goal" | "completed" | "timeout";
export type EndReason = MatchEndReason | "stopped" | "forfeit" | "reset" | "lobby-expired" | "no-play" | "host-offline" | "error";

export interface Progress { value: number; target: number; label: string }
export interface GridTile {
  kind: string;
  label?: string;
  mask?: number;
  tint?: number;
  action?: boolean;
  title?: string;
}
export interface Board {
  kind: "grid";
  width: number;
  height: number;
  tiles: GridTile[];
}
export interface Tubes { kind: "tubes"; tubes: number[][]; selected: number; capacity: number }
export interface Prompt { id: number; text: string; numbers?: number[]; options?: { label: string; value: string }[] }
export interface Quiz {
  kind: "quiz";
  prompt?: Prompt;
  attempted: number;
  correct: number;
  feedback?: "correct" | "incorrect";
  bricks?: number;
  brickTotal?: number;
}
export interface ArcadeActor { kind: string; x: number; y: number; width: number; height: number; tint?: number }
export interface Arcade { kind: "arcade"; theme: "space" | "road" | "desert"; actors: ArcadeActor[]; rows?: string[] }
export type Scene = Board | Tubes | Quiz | Arcade;
export interface AnswerStats { attempted: number; correct: number }
export interface ResultMetrics extends Partial<AnswerStats> { progress?: Progress; sideAnswers?: AnswerStats }

export interface Result {
  playerId: string;
  playerName: string;
  sessionId: string;
  gameId: string;
  teamId: string;
  round: number;
  step: number | null;
  participated: boolean;
  assisting: boolean;
  outcome: "win" | "lose" | "absent";
  tied: boolean;
  rawPoints: number;
  baseAwarded: number;
  awarded: number;
  doublePoints: boolean;
  duration: number;
  date: number;
  metrics: ResultMetrics;
}
export interface TeamResult { sessionId: string; teamId: string; gameId: string; round: number; rawTotal: number; average: number; date: number }
export interface PlayerIdentity { id: string; name: string; teamId: string; totalScore: number; connected: boolean }
export interface PlayerRank extends PlayerIdentity {
  rank: number; teamName: string; completed: number; wins: number; ties: number; losses: number;
  soloScore: number; multiScore: number; duration: number;
}
export interface TeamRank {
  id: string; name: string; rank: number; score: number; completed: number; wins: number;
  duration: number; members: PlayerRank[];
}
export interface Leaderboard { players: PlayerRank[]; teams: TeamRank[] }
export interface Member {
  id: string; name: string; connected: boolean; ready: boolean; participated: boolean;
  forfeited: boolean; progress?: Progress; tint: number;
  checkedIn: boolean; position: number; side: number | null; assisting?: boolean;
}
export type SideCompletion = "cleared" | "exhausted";
export interface MatchPanel {
  side: number; scene: Scene | null; progress: Progress | null; cursor: number | null; completion?: SideCompletion;
}
export interface RemoteControls { questionId?: number; choices?: number; completion?: SideCompletion; answerAvailableAt?: number }
export interface MatchView {
  mode: MatchMode; arrivalDeadline: number; winner: number | null;
  panels?: MatchPanel[]; remote?: RemoteControls;
}
export interface RoomView {
  id: string; stationId: string; gameId: string; hostId: string; teamId: string | null; round: number;
  status: RoomStatus; startedAt: number | null; deadline: number | null; reason: EndReason | null;
  pausedAt?: number;
  now: number; members: Member[]; scene: Scene | null; progress: Progress | null; seq: number;
  doubleChallenge: DoubleChallenge | null;
  course: { step: number; tier: Difficulty } | null;
  match: MatchView | null;
}
export interface DoubleChallenge { playerId: string; playerName: string; startedAt: number; tier?: Difficulty }
export interface FloorMapStatus { revision: number; custom: boolean }
export interface StationView {
  id: string; name: string; floor: Floor; x: number; y: number; hostId: string; gameId: string;
  open: boolean; online: boolean; queued: number; completed: number; round: number;
  activity: { id: string; status: RoomStatus; teamId: string | null; names: string[]; startedAt: number | null; deadline: number | null } | null;
}
export interface CampusState {
  competitionId: number; now: number; stations: StationView[]; games: (Omit<GameInfo, "mode"> & { mode: "versus"; enabled: boolean })[];
  leaderboard: Leaderboard; floorMaps: Record<Floor, FloorMapStatus>; doubleChance: number; selfRegistration: boolean;
}
export interface QueueView { stationId: string; position: number }
export interface RouteView {
  completed: number; searching: boolean;
  assisting?: boolean;
  next: { step: number | null; tier: Difficulty; gameId: string; stationId: string } | null;
}
export interface PlayerView {
  player: PlayerIdentity; teamRank: number; results: Result[]; queue: QueueView | null;
  room: RoomView | null; lastResult: Result | null; lastTeamResult: TeamResult | null; now: number;
  route: RouteView;
}
export interface HostView {
  hostId: string; station: StationView; room: RoomView | null;
  results: Result[]; teamResult: TeamResult | null; entry: StationEntry | null;
}
export interface StationEntry { stationId: string; url: string; expiresAt: number }
export interface AdminState {
  competitionId: number; selfRegistration: boolean; liveRooms: number; queuedPlayers: number;
  competitions: CompetitionSummary[];
  players: (PlayerIdentity & {
    stationId: string | null; needsLink: boolean; studentNumber: string | null; suspended: boolean;
  })[];
  audit: { action: string; detail: string; date: number }[];
  connections: { sockets: number; players: number; hosts: number; errors: number };
  sessions: { id: string; stationId: string; gameId: string; competitionId: number; teamId: string | null; round: number; step: number | null; status: RoomStatus; startedAt: number | null; endedAt: number; reason: EndReason | null; voidedAt: number | null }[];
}
export interface CompetitionSummary {
  id: number; openedAt: number; closedAt: number | null; resetReason: string | null;
}
export interface StudentCredential { id: string; name: string; studentNumber: string; code: string }

export interface ClientEvents {
  "campus:watch": (body: null, ack: (value: Ack<CampusState>) => void) => void;
  "clock:sync": (body: null, ack: (value: Ack<number>) => void) => void;
  "player:join": (body: z.infer<typeof registrationSchema>, ack: (value: Ack<{ token: string; state: PlayerView }>) => void) => void;
  "player:login": (body: z.input<typeof studentLoginSchema>, ack: (value: Ack<{ token: string; state: PlayerView }>) => void) => void;
  "player:reconnect": (body: { token: string }, ack: (value: Ack<PlayerView>) => void) => void;
  "player:leave": (body: null, ack: (value: Ack) => void) => void;
  "team:join": (body: { teamId: string }, ack: (value: Ack<PlayerView>) => void) => void;
  "match:find": (body: null, ack: (value: Ack<PlayerView>) => void) => void;
  "match:assist": (body: null, ack: (value: Ack<PlayerView>) => void) => void;
  "match:cancel": (body: null, ack: (value: Ack<PlayerView>) => void) => void;
  "station:scan": (body: { stationId: string; code: string }, ack: (value: Ack) => void) => void;
  "station:join": (body: { stationId: string }, ack: (value: Ack<PlayerView>) => void) => void;
  "station:leave": (body: null, ack: (value: Ack<PlayerView>) => void) => void;
  "game:ready": (body: { sessionId: string; ready: boolean }, ack: (value: Ack<PlayerView>) => void) => void;
  "game:input": (body: z.infer<typeof inputSchema>, ack?: (value: Ack<{ seq: number }>) => void) => void;
  "practice:join": (body: { role: PracticeRole; credential: string; entryOrigin?: string },
    ack: (value: Ack<{ token: string; view: PracticeView }>) => void) => void;
  "practice:select": (body: { gameId: string }, ack: (value: Ack<PracticeView>) => void) => void;
  "practice:start": (body: null, ack: (value: Ack<PracticeView>) => void) => void;
  "practice:stop": (body: null, ack: (value: Ack<PracticeView>) => void) => void;
  "practice:input": (body: z.infer<typeof inputSchema>, ack: (value: Ack<{ seq: number }>) => void) => void;
  "host:register": (body: { hostId: string; key: string; entryOrigin?: string; screenVersion?: number }, ack: (value: Ack<HostView>) => void) => void;
  "admin:watch": (body: { key: string }, ack: (value: Ack<AdminState>) => void) => void;
}

export interface ServerEvents {
  "campus:state": (value: CampusState) => void;
  "player:update": (value: PlayerView) => void;
  "player:kicked": (value: { message: string; replaced: boolean }) => void;
  "team:update": (value: TeamRank[]) => void;
  "team:status": (value: { sessionId: string; members: Member[] }) => void;
  "game:start": (value: RoomView) => void;
  "game:state": (value: RoomView) => void;
  "game:progress": (value: { sessionId: string; progress: Progress | null }) => void;
  "game:double-challenge": (value: { sessionId: string; challenge: DoubleChallenge }) => void;
  "game:finish": (value: RoomView) => void;
  "game:timeout": (value: RoomView) => void;
  "practice:state": (value: PracticeView) => void;
  "practice:replaced": (value: null) => void;
  "score:result": (value: Result) => void;
  "score:team-average": (value: TeamResult) => void;
  "score:leaderboard": (value: Leaderboard) => void;
  "host:status": (value: HostView) => void;
  "host:entry": (value: StationEntry | null) => void;
  "station:update": (value: StationView[]) => void;
  "admin:status": (value: AdminState) => void;
  "system:error": (value: { error: string; code: string }) => void;
}

