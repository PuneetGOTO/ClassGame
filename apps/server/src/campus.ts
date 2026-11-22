import { randomInt, randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { COUNTDOWN_MS, GAME_MS, LOBBY_MS, GAMES, TEAM_SIZE } from "../../../packages/shared/catalog";
import { floorLabel, type Floor } from "../../../packages/shared/floors";
import { DOUBLE_END_MS, DOUBLE_START_MS, STATION_SCAN_GRANT_MS } from "../../../packages/shared/rules";
import { routeTier } from "../../../packages/shared/route";
import type {
  AdminState, CampusState, ClientEvents, EndReason, HostView, PlayerView, RoomView, ServerEvents, StationEntry, StationView
} from "../../../packages/shared/protocol";
import type { Engine, PluginFactory } from "../../../packages/game-sdk";
import { settle, type Outcome } from "./scoring";
import { RequestError, Store, type MemberRow, type QueueRow, type SessionRow } from "./store";
import { checkStationQr, qrExpiry, stationQr } from "./station-qr";

export type PeerData = { playerId?: string; hostId?: string; entryOrigin?: string;
  stationScan?: { stationId: string; hostConnection: string; expiresAt: number } };
export type CampusSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, PeerData>;
export type CampusIO = Server<ClientEvents, ServerEvents, Record<string, never>, PeerData>;
interface Room { row: SessionRow; members: Map<string, MemberRow>; engine?: Engine }
const resultDisplayMs = 5000;
const queueLifetimeMs = 20 * 60_000;

export class Campus {
  private readonly rooms = new Map<string, Room>();
  private readonly lastAtStation = new Map<string, Room>();
  private readonly players = new Map<string, CampusSocket>();
  private readonly hosts = new Map<string, CampusSocket>();
  private readonly inputBuckets = new Map<string, { tokens: number; at: number }>();
  private dirty = true;
  private leader: ReturnType<Store["leaderboard"]>;
  private errors = 0;
  private lastQrExpiry = 0;

  constructor(
    readonly store: Store,
    private io: CampusIO,
    private plugins: ReadonlyMap<string, PluginFactory>,
    private entry: (origin?: string, station?: string) => string,
    private qrSecret: string,
    readonly now: () => number = Date.now
  ) {
    this.leader = store.leaderboard();
    const rows = this.store.all<SessionRow>(`SELECT * FROM game_sessions WHERE competition_id=? AND
      (status IN ('lobby','countdown','running') OR (status='finished' AND ended_at>=?)) ORDER BY ended_at, created_at`,
      this.store.competitionId, this.now() - resultDisplayMs);
    for (const row of rows) {
      const members = this.store.all<MemberRow>("SELECT * FROM session_members WHERE session_id=? ORDER BY rowid", row.session_id);
      const room = { row, members: new Map(members.map(member => [member.player_id, member])) };
      try {
        if (row.status === "finished") this.lastAtStation.set(row.station_id, room);
        else this.rooms.set(row.station_id, room);
        if (row.engine_state) this.restoreEngine(room);
      } catch (error) {
        this.recordError(error, row.session_id);
        if (row.status !== "finished") this.cancel(room, "error");
      }
    }
  }

  private memberRoom(playerId: string) {
    return [...this.rooms.values()].find(room => room.members.has(playerId));
  }
  private playerStation(playerId: string) {
    return this.memberRoom(playerId)?.row.station_id
      ?? this.store.get<QueueRow>("SELECT * FROM station_queue WHERE player_id=?", playerId)?.station_id ?? null;
  }
  private station(id: string) {
    const row = this.store.stationRows().find(station => station.id === id);
    if (!row) throw new RequestError("找不到遊戲站點", "not-found", 404);
    return this.stationView(row);
  }
  private stationView(row: ReturnType<Store["stationRows"]>[number]): StationView {
    const room = this.rooms.get(row.id);
    return { ...row, open: Boolean(row.open), online: Boolean(row.online), round: 1,
      activity: room ? { id: room.row.session_id, status: room.row.status, teamId: room.row.team_id,
        names: [...room.members.keys()].map(id => this.store.player(id)!.player_name), startedAt: room.row.started_at, deadline: room.row.deadline } : null };
  }
  snapshot(): CampusState {
    return {
      competitionId: this.store.competitionId, now: this.now(),
      stations: this.store.stationRows().map(row => this.stationView(row)),
      games: GAMES.map(game => ({
        ...game, enabled: Boolean(this.store.get<{ enabled: number }>("SELECT enabled FROM games WHERE game_id=?", game.id)?.enabled)
      })),
      leaderboard: this.leader, floorMaps: this.store.mapStatus(), doubleChance: this.store.doubleChance()
    };
  }
  private roomView(room: Room, viewer?: string): RoomView {
    const { row, engine, members } = room;
    const participants = [...members.values()].filter(member => member.participated).map(member => member.player_id);
    const showScene = row.status !== "countdown";
    return {
      id: row.session_id, gameId: row.game_id, hostId: row.host_id, stationId: row.station_id, teamId: row.team_id,
      startedAt: row.started_at, deadline: row.deadline, round: row.round_no, status: row.status, reason: row.reason, now: this.now(),
      seq: viewer ? members.get(viewer)?.last_seq ?? 0 : 0,
      course: row.route_step ? { step: row.route_step, tier: routeTier(row.route_step) } : null,
      doubleChallenge: row.double_player_id && row.double_started_at != null ? {
        playerId: row.double_player_id,
        playerName: this.store.player(row.double_player_id)!.player_name,
        startedAt: row.double_started_at
      } : null,
      members: [...members.values()].map((member, i) => {
        const player = this.store.player(member.player_id)!;
        return {
          id: player.player_id, name: player.player_name, connected: Boolean(player.connected),
          ready: Boolean(member.ready), participated: Boolean(member.participated), forfeited: Boolean(member.forfeited),
          progress: showScene && member.participated ? engine?.getProgress(player.player_id) : undefined,
          tint: (member.participated ? participants.indexOf(player.player_id) : i) % TEAM_SIZE
        };
      }),
      scene: showScene && (viewer || !row.route_step) ? engine?.getState(viewer) ?? null : null,
      progress: showScene ? engine?.getProgress(viewer) ?? null : null
    };
  }
  playerView(id: string): PlayerView {
    const row = this.store.player(id);
    if (!row) throw new RequestError("找不到玩家", "not-found", 404);
    this.store.ensureRoute(id);
    const room = this.memberRoom(id);
    const ticket = this.store.get<QueueRow>("SELECT * FROM station_queue WHERE player_id=?", id);
    const lastResult = this.store.recentFor(id);
    const results = this.store.officialFor(id);
    const next = this.store.nextRoute(id);
    const position = ticket ? this.store.queue(ticket.station_id).findIndex(item => item.ticket === ticket.ticket) + 1 : 0;
    return {
      player: this.store.publicPlayer(row), teamRank: this.leader.teams.find(t => t.id === row.team_id)?.rank ?? 0,
      results, queue: ticket ? { stationId: ticket.station_id, position } : null,
      route: { completed: results.length, next: next ? {
        step: next.step, gameId: next.gameId, stationId: next.stationId, tier: routeTier(next.step)
      } : null },
      room: room ? this.roomView(room, id) : null,
      lastResult, lastTeamResult: lastResult ? this.store.teamResult(lastResult.sessionId) : null, now: this.now()
    };
  }
  hostView(id: string, origin?: string): HostView {
    const station = this.station(this.store.get<{ station_id: string }>("SELECT station_id FROM hosts WHERE host_id=?", id)!.station_id);
    const room = this.rooms.get(station.id) ?? this.lastAtStation.get(station.id);
    const ended = room?.row.status === "finished" ? room.row.session_id : null;
    return {
      hostId: id, station, room: room ? this.roomView(room) : null,
      results: ended ? this.store.resultsForSession(ended) : [],
      teamResult: ended ? this.store.teamResult(ended) : null,
      entry: this.stationEntry(station, qrExpiry(this.now()), origin)
    };
  }
  private stationEntry(station: Pick<StationView, "id" | "hostId" | "open">, expiresAt: number, origin?: string): StationEntry | null {
    const host = this.hosts.get(station.hostId);
    if (!station.open || !host) return null;
    const url = new URL(this.entry(origin, station.id));
    url.hash = new URLSearchParams({ scan: stationQr(this.qrSecret, station.id, host.id, expiresAt) }).toString();
    return { stationId: station.id, url: url.href, expiresAt };
  }
  private rotateEntries(now: number) {
    const expiresAt = qrExpiry(now);
    if (expiresAt === this.lastQrExpiry) return;
    this.lastQrExpiry = expiresAt;
    if (!this.hosts.size) return;
    for (const station of this.store.stationRows()) {
      const host = this.hosts.get(station.hostId);
      if (host) host.emit("host:entry", this.stationEntry(station, expiresAt, host.data.entryOrigin));
    }
  }
  scanStation(socket: CampusSocket, stationId: string, code: string) {
    if (socket.data.hostId) throw new RequestError("請用手機控制器掃碼", "wrong-client", 403);
    const station = this.station(stationId);
    if (!station.open) throw new RequestError("此站暫停入場", "station-closed", 409);
    const host = this.hosts.get(station.hostId);
    if (!host) throw new RequestError("此站主機尚未連線", "host-offline", 409);
    const now = this.now();
    const check = checkStationQr(this.qrSecret, stationId, host.id, now, code);
    if (check === "expired") throw new RequestError("QR Code 已過期，請掃描房間大螢幕上的新碼", "qr-expired", 403);
    if (check !== "valid") throw new RequestError("QR Code 與此房間不符，請重新掃碼", "qr-invalid", 403);
    if (socket.data.playerId && this.playerStation(socket.data.playerId) !== stationId) {
      this.checkAttempt(socket.data.playerId, station);
    }
    socket.data.stationScan = { stationId, hostConnection: host.id, expiresAt: now + STATION_SCAN_GRANT_MS };
    return null;
  }
  adminView(): AdminState {
    return {
      competitionId: this.store.competitionId,
      players: this.store.players().map(player => ({ ...this.store.publicPlayer(player), stationId: this.playerStation(player.player_id),
        needsLink: !player.token_hash })),
      audit: this.store.all("SELECT action,detail,created_at AS date FROM audit_log ORDER BY id DESC LIMIT 100"),
      connections: { sockets: this.io.sockets.sockets.size, players: this.players.size, hosts: this.hosts.size, errors: this.errors },
      sessions: this.store.sessionHistory(Number.MAX_SAFE_INTEGER, 60).sessions
    };
  }
  mark() { this.dirty = true; }
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const previous = this.leader;
    this.leader = this.store.leaderboard();
    const snapshot = this.snapshot();
    this.io.to("campus").emit("campus:state", snapshot);
    this.io.to("campus").emit("station:update", snapshot.stations);
    if (JSON.stringify(previous) !== JSON.stringify(this.leader)) {
      this.io.to("campus").emit("score:leaderboard", this.leader);
      this.io.to("campus").emit("team:update", this.leader.teams);
    }
    for (const [id,socket] of this.players) socket.emit("player:update", this.playerView(id));
    for (const [id,socket] of this.hosts) socket.emit("host:status", this.hostView(id, socket.data.entryOrigin));
    this.io.to("admin").emit("admin:status", this.adminView());
  }
  private pushRoom(room: Room, event: "game:state" | "game:start" | "game:finish" | "game:timeout" = "game:state") {
    const send = (socket: CampusSocket | undefined, view: RoomView) => {
      if (!socket) return;
      socket.emit(event, view);
      if (event === "game:state") {
        socket.emit("game:progress", { sessionId: view.id, progress: view.progress });
      } else {
        socket.emit("team:status", { sessionId: view.id, members: view.members });
      }
    };
    for (const id of room.members.keys()) send(this.players.get(id), this.roomView(room, id));
    send(this.hosts.get(room.row.host_id), this.roomView(room));
  }
  private requireFreeSocket(socket: CampusSocket) {
    if (socket.data.playerId || socket.data.hostId) throw new RequestError("此連線已綁定身分", "bound", 409);
  }
  playerId(socket: CampusSocket) {
    const id = socket.data.playerId;
    if (!id || this.players.get(id) !== socket) throw new RequestError("請先加入或恢復玩家身分", "unauthorized", 401);
    return id;
  }
  joinPlayer(socket: CampusSocket, name: string, teamId?: string) {
    this.requireFreeSocket(socket);
    const { id, token } = this.store.addPlayer(name, teamId, this.now());
    return { token, state: this.attachPlayer(socket, id) };
  }
  reconnect(socket: CampusSocket, token: string) {
    const player = this.store.playerFromToken(token);
    if (!player) throw new RequestError("手機連結已失效，請重新入場或向管理員取得連結", "invalid-token", 401);
    if (socket.data.playerId === player.player_id && this.players.get(player.player_id) === socket) return this.playerView(player.player_id);
    this.requireFreeSocket(socket);
    return this.attachPlayer(socket, player.player_id);
  }
  private attachPlayer(socket: CampusSocket, id: string) {
    const old = this.players.get(id);
    socket.data.playerId = id;
    this.players.set(id, socket);
    old?.emit("player:kicked", { message: "此身分已在另一個裝置連線", replaced: true });
    old?.disconnect(true);
    this.store.run("UPDATE players SET connected=1 WHERE player_id=?", id);
    const stationId = this.playerStation(id);
    if (stationId) {
      this.promote(stationId);
      const room = this.memberRoom(id);
      if (room?.row.status === "lobby") this.maybeStart(room);
    }
    this.mark();
    return this.playerView(id);
  }
  leavePlayer(socket: CampusSocket) {
    const id = this.playerId(socket);
    this.leaveStation(id);
    socket.data.stationScan = undefined;
    this.detachPlayer(socket, id);
  }
  private detachPlayer(socket: CampusSocket, id: string) {
    if (this.players.get(id) !== socket) return;
    this.players.delete(id);
    socket.data.playerId = undefined;
    this.store.run("UPDATE players SET connected=0 WHERE player_id=?", id);
    this.mark();
  }
  registerHost(socket: CampusSocket, hostId: string, origin?: string) {
    if (socket.data.hostId === hostId && this.hosts.get(hostId) === socket) return this.hostView(hostId, socket.data.entryOrigin);
    this.requireFreeSocket(socket);
    const old = this.hosts.get(hostId);
    socket.data.hostId = hostId;
    socket.data.entryOrigin = origin;
    this.hosts.set(hostId, socket);
    old?.emit("system:error", { error: "這台主機已在另一個分頁或裝置登記", code: "host-replaced" });
    old?.disconnect(true);
    this.store.run("UPDATE hosts SET connection_status=1 WHERE host_id=?", hostId);
    const station = this.hostView(hostId, origin).station;
    this.promote(station.id);
    const room = this.rooms.get(station.id);
    if (room?.row.status === "lobby") this.maybeStart(room);
    this.mark();
    return this.hostView(hostId, origin);
  }
  disconnect(socket: CampusSocket) {
    if (socket.data.playerId) this.detachPlayer(socket, socket.data.playerId);
    const hostId = socket.data.hostId;
    if (hostId && this.hosts.get(hostId) === socket) {
      this.hosts.delete(hostId);
      this.store.run("UPDATE hosts SET connection_status=0 WHERE host_id=?", hostId);
    }
    this.mark();
  }
  private checkAttempt(playerId: string, station: StationView) {
    this.store.ensureRoute(playerId);
    const next = this.store.nextRoute(playerId);
    if (!next) throw new RequestError("你已完成全部 20 關", "course-complete", 409);
    if (next.stationId !== station.id) {
      const assigned = this.station(next.stationId);
      throw new RequestError("這一關請前往" + floorLabel[assigned.floor] + " " + assigned.name + "掃碼", "wrong-route", 403);
    }
    return next;
  }
  enterStation(socket: CampusSocket, stationId: string) {
    const id = this.playerId(socket);
    const station = this.station(stationId);
    const current = this.playerStation(id);
    if (current === stationId) return this.playerView(id);
    if (current) throw new RequestError("請先離開目前的站點", "already-in-station", 409);
    if (!station.open || !this.store.get<{ enabled: number }>("SELECT enabled FROM games WHERE game_id=?", station.gameId)?.enabled) {
      throw new RequestError("此站暫停入場", "station-closed", 409);
    }
    if (!station.online) throw new RequestError("此站主機尚未連線", "host-offline", 409);
    const scan = socket.data.stationScan;
    if (!scan || scan.stationId !== stationId || scan.hostConnection !== this.hosts.get(station.hostId)?.id || scan.expiresAt <= this.now()) {
      throw new RequestError("請到房間掃描大螢幕上的最新 QR Code", "scan-required", 403);
    }
    const player = this.store.player(id)!;
    this.checkAttempt(id, station);
    this.store.run("INSERT INTO station_queue(station_id,player_id,team_id,created_at) VALUES (?,?,?,?)",
      stationId, id, player.team_id, this.now());
    socket.data.stationScan = undefined;
    this.promote(stationId);
    this.mark();
    return this.playerView(id);
  }
  leaveStation(id: string, admin = false) {
    const room = this.memberRoom(id);
    const ticket = this.store.get<QueueRow>("SELECT * FROM station_queue WHERE player_id=?", id);
    if (room && room.row.status !== "lobby" && !admin) {
      throw new RequestError("本場已開始，請等候結算", "in-progress", 409);
    }
    if (ticket) this.store.run("DELETE FROM station_queue WHERE player_id=?", id);
    if (room) this.cancel(room, "forfeit");
    const stationId = room?.row.station_id ?? ticket?.station_id;
    if (stationId) this.promote(stationId);
    this.mark();
    return this.playerView(id);
  }
  private promote(stationId: string) {
    const station = this.station(stationId);
    if (!station.open || !station.online || this.rooms.has(stationId)) return;
    const now = this.now();
    const last = this.lastAtStation.get(stationId);
    if (last && last.row.ended_at! + resultDisplayMs > now) return;
    for (const ticket of this.store.queue(stationId)) {
      if (now - ticket.created_at >= queueLifetimeMs) {
        this.store.run("DELETE FROM station_queue WHERE ticket=?", ticket.ticket);
        this.mark();
        continue;
      }
      if (!this.players.has(ticket.player_id)) continue;
      let next;
      try { next = this.checkAttempt(ticket.player_id, station); }
      catch (error) {
        if (!(error instanceof RequestError)) throw error;
        this.store.run("DELETE FROM station_queue WHERE ticket=?", ticket.ticket);
        this.players.get(ticket.player_id)?.emit("system:error", { error: error.message, code: error.code });
        this.mark();
        continue;
      }
      const row: SessionRow = {
        session_id: randomUUID(), competition_id: this.store.competitionId, game_id: station.gameId, station_id: stationId,
        host_id: station.hostId, team_id: null, round_no: 1, created_at: now,
        started_at: null, deadline: null, ended_at: null, status: "lobby", reason: null, seed: next.seed, engine_state: null, roster: "[]",
        double_due_at: null, double_player_id: null, double_started_at: null, route_step: next.step
      };
      this.store.transaction(() => {
        this.store.run(`INSERT INTO game_sessions(session_id,competition_id,game_id,station_id,host_id,
          round_no,created_at,status,seed,route_step) VALUES (?,?,?,?,?,?,?,?,?,?)`, row.session_id, row.competition_id, row.game_id,
          row.station_id, row.host_id, row.round_no, row.created_at, row.status, row.seed, next.step);
        this.store.run("INSERT INTO session_members(session_id,player_id,team_id) VALUES (?,?,?)", row.session_id, ticket.player_id, ticket.team_id);
        this.store.run("DELETE FROM station_queue WHERE ticket=?", ticket.ticket);
      });
      const member = { player_id: ticket.player_id, team_id: ticket.team_id, ready: 0, participated: 0,
        forfeited: 0, last_seq: 0, won_at: null, played: 0 };
      this.rooms.set(stationId, { row, members: new Map([[member.player_id, member]]) });
      this.mark();
      break;
    }
  }
  ready(id: string, sessionId: string, ready: boolean) {
    const room = this.memberRoom(id);
    if (!room || room.row.session_id !== sessionId) throw new RequestError("你尚未加入這個場次", "wrong-session", 403);
    if (room.row.status !== "lobby") return this.playerView(id);
    const member = room.members.get(id)!;
    this.store.run("UPDATE session_members SET ready=? WHERE session_id=? AND player_id=?", Number(ready), sessionId, id);
    member.ready = Number(ready);
    this.maybeStart(room);
    this.mark();
    return this.playerView(id);
  }
  private maybeStart(room: Room, admin = false) {
    if (!this.hosts.has(room.row.host_id)) {
      if (admin) throw new RequestError("此站主機尚未連線", "host-offline", 409);
      return;
    }
    const onlineReady = [...room.members.values()].filter(member => member.ready && this.players.has(member.player_id));
    if (!onlineReady.length) {
      if (admin) throw new RequestError("請等待玩家就緒", "not-ready", 409);
      return;
    }
    const { row } = room;
    const participants = onlineReady.map(member => member.player_id);
    const factory = this.plugins.get(row.game_id);
    if (!factory) throw new RequestError("此關插件尚未啟用", "plugin-unavailable", 409);
    const engine = factory({ playerIds: participants, seed: row.seed, tier: row.route_step ? routeTier(row.route_step) : undefined });
    const startedAt = this.now() + COUNTDOWN_MS;
    const deadline = startedAt + GAME_MS;
    const engineState = engine.serialize();
    const doubleDueAt = this.store.transaction(() => {
      const offset = this.store.get<{ double_offset: number | null }>(`SELECT double_offset FROM player_routes
        WHERE competition_id=? AND player_id=? AND step=?`, row.competition_id, participants[0], row.route_step ?? 0)?.double_offset
        ?? (randomInt(100) < this.store.doubleChance() ? randomInt(DOUBLE_START_MS, DOUBLE_END_MS + 1) : -1);
      if (row.route_step) this.store.run(`UPDATE player_routes SET double_offset=?
        WHERE competition_id=? AND player_id=? AND step=? AND double_offset IS NULL`,
        offset, row.competition_id, participants[0], row.route_step);
      const due = offset < 0 ? null : startedAt + offset;
      for (const member of onlineReady) this.store.run("UPDATE session_members SET participated=1 WHERE session_id=? AND player_id=?",
        row.session_id, member.player_id);
      this.store.run(`UPDATE game_sessions SET status='countdown',started_at=?,deadline=?,roster=?,engine_state=?,double_due_at=? WHERE session_id=?`,
        startedAt, deadline, JSON.stringify(participants), engineState, due, row.session_id);
      return due;
    });
    for (const member of onlineReady) member.participated = 1;
    Object.assign(row, { status: "countdown", started_at: startedAt, deadline, roster: JSON.stringify(participants),
      engine_state: engineState, double_due_at: doubleDueAt });
    room.engine = engine;
    this.pushRoom(room, "game:start");
    this.mark();
  }
  private restoreEngine(room: Room) {
    const factory = this.plugins.get(room.row.game_id);
    if (!factory) throw new Error("Missing plugin " + room.row.game_id);
    room.engine = factory({
      seed: room.row.seed, tier: room.row.route_step ? routeTier(room.row.route_step) : undefined,
      playerIds: [...room.members.values()].filter(member => member.participated).map(member => member.player_id)
    }, room.row.engine_state);
  }
  private frame(room: Room, now: number) {
    return {
      elapsed: Math.max(0, Math.min(GAME_MS, now - room.row.started_at!)),
      activePlayers: [...room.members.values()].filter(m => m.participated && !m.forfeited && this.players.has(m.player_id)).map(m => m.player_id)
    };
  }
  private checkpoint(room: Room, now: number, sequence?: { member: MemberRow; seq: number }) {
    const { row, engine } = room;
    const engineState = engine!.serialize();
    const wins = [...room.members.values()].filter(member => member.participated && !member.forfeited && member.won_at === null
      && engine!.checkWin(member.player_id));
    this.store.transaction(() => {
      this.store.run("UPDATE game_sessions SET engine_state=? WHERE session_id=?", engineState, row.session_id);
      if (sequence) this.store.run("UPDATE session_members SET last_seq=?, played=1 WHERE session_id=? AND player_id=?",
        sequence.seq, row.session_id, sequence.member.player_id);
      for (const member of wins) this.store.run("UPDATE session_members SET won_at=? WHERE session_id=? AND player_id=?",
        now, row.session_id, member.player_id);
    });
    row.engine_state = engineState;
    if (sequence) Object.assign(sequence.member, { last_seq: sequence.seq, played: 1 });
    for (const member of wins) member.won_at = now;
  }
  private throttle(id: string) {
    const now = this.now();
    const previous = this.inputBuckets.get(id) ?? { tokens: 12, at: now };
    const tokens = Math.min(12, previous.tokens + Math.max(0, now - previous.at) / 80);
    if (tokens < 1) throw new RequestError("操作太快，請稍後再試", "rate", 429);
    this.inputBuckets.set(id, { tokens: tokens - 1, at: now });
  }
  input(id: string, payload: Parameters<ClientEvents["game:input"]>[0]) {
    const room = this.memberRoom(id);
    const { sessionId, seq, action } = payload;
    if (!room || sessionId !== room.row.session_id) throw new RequestError("操作所屬場次無效", "wrong-session", 403);
    const member = room.members.get(id)!;
    if (seq <= member.last_seq) return { seq: member.last_seq };
    this.throttle(id);
    const now = this.now();
    this.advance(room, now);
    if (room.row.status !== "running" || !member.participated || member.forfeited) {
      throw new RequestError("目前不能操作此場次", "not-running", 409);
    }
    if (room.engine!.handleInput(id, action, this.frame(room, now))) {
      this.checkpoint(room, now, { member, seq });
      if (room.engine!.isComplete()) this.finish(room, "goal", now);
      else this.pushRoom(room);
    } else {
      this.store.run("UPDATE session_members SET last_seq=? WHERE session_id=? AND player_id=?", seq, sessionId, id);
      member.last_seq = seq;
    }
    return { seq };
  }
  private advance(room: Room, now: number) {
    const { row, engine } = room;
    if (row.status === "countdown" && now >= row.started_at!) {
      engine!.start();
      const state = engine!.serialize();
      this.store.run("UPDATE game_sessions SET status='running',engine_state=? WHERE session_id=?", state, row.session_id);
      row.status = "running";
      row.engine_state = state;
      this.mark();
      if (now < row.deadline!) this.pushRoom(room);
    }
    if (row.status !== "running") return;
    if (now >= row.deadline!) {
      if (row.route_step && ![...room.members.values()].some(member => member.played)) {
        this.cancel(room, "no-play");
        return;
      }
      // Simulate the final slice before judging, but accept no input at or after the deadline.
      if (engine!.tick(this.frame(room, row.deadline!))) this.checkpoint(room, row.deadline!);
      this.finish(room, "timeout", row.deadline!);
      return;
    }
    this.maybeRevealDouble(room, now);
    if (engine!.timed && engine!.tick(this.frame(room, now))) {
      this.checkpoint(room, now);
      if (engine!.isComplete()) this.finish(room, "goal", now);
      else this.pushRoom(room);
    }
  }
  private maybeRevealDouble(room: Room, now: number) {
    const { row, members } = room;
    if (row.double_due_at == null || row.double_player_id || now < row.double_due_at || row.deadline! - now < 5000) return;
    const candidates = [...members.values()].filter(member =>
      member.participated && !member.forfeited && member.won_at == null);
    if (!candidates.length) return;
    const playerId = candidates[randomInt(candidates.length)].player_id;
    const change = this.store.run(`UPDATE game_sessions SET double_player_id=?,double_started_at=?
      WHERE session_id=? AND status='running' AND double_player_id IS NULL`, playerId, now, row.session_id);
    if (Number(change.changes) !== 1) return;
    Object.assign(row, { double_player_id: playerId, double_started_at: now });
    const challenge = { playerId, playerName: this.store.player(playerId)!.player_name, startedAt: now };
    const event = { sessionId: row.session_id, challenge };
    for (const id of members.keys()) this.players.get(id)?.emit("game:double-challenge", event);
    this.hosts.get(row.host_id)?.emit("game:double-challenge", event);
    this.pushRoom(room);
  }
  private finish(room: Room, reason: EndReason, now: number) {
    const { row, members, engine } = room;
    engine!.finish();
    const roster: string[] = JSON.parse(row.roster);
    const outcomes: Outcome[] = roster.map(playerId => {
      const member = members.get(playerId);
      const participated = Boolean(member?.participated);
      const won = Boolean(participated && !member?.forfeited && this.players.has(playerId) && engine!.checkWin(playerId));
      const scene = participated ? engine!.getState(playerId) : null;
      return {
        playerId, teamId: row.team_id ?? member!.team_id, participated, won,
        duration: participated ? (won ? member!.won_at ?? now : now) - row.started_at! : 0,
        metrics: participated ? {
          progress: engine!.getProgress(playerId),
          ...(scene?.kind === "quiz" ? { attempted: scene.attempted, correct: scene.correct } : {})
        } : undefined
      };
    });
    if (!settle(this.store, row, outcomes, reason, now)) return;
    Object.assign(row, { status: "finished", ended_at: now, reason });
    this.rooms.delete(row.station_id);
    this.lastAtStation.set(row.station_id, room);
    this.pushRoom(room, reason === "timeout" ? "game:timeout" : "game:finish");
    const team = this.store.teamResult(row.session_id);
    const resultList = this.store.resultsForSession(row.session_id);
    for (const result of resultList) {
      if (!result.participated) continue;
      const socket = this.players.get(result.playerId);
      socket?.emit("score:result", result);
      if (team) socket?.emit("score:team-average", team);
    }
    const host = this.hosts.get(row.host_id);
    for (const result of resultList) host?.emit("score:result", result);
    if (team) host?.emit("score:team-average", team);
    this.mark();
  }
  private cancel(room: Room, reason: EndReason) {
    const { row } = room;
    this.store.run("UPDATE game_sessions SET status='cancelled',ended_at=?,reason=? WHERE session_id=?", this.now(), reason, row.session_id);
    row.status = "cancelled";
    row.reason = reason;
    this.rooms.delete(row.station_id);
    this.pushRoom(room, "game:finish");
    if (reason === "no-play") {
      for (const id of room.members.keys()) this.players.get(id)?.emit("system:error", {
        error: "本場尚未操作。請重新掃碼挑戰同一任務。", code: reason
      });
    }
    room.engine?.destroy();
    this.mark();
  }
  step() {
    const now = this.now();
    this.rotateEntries(now);
    for (const room of this.rooms.values()) {
      try {
        if (room.row.status === "lobby" && now - room.row.created_at >= LOBBY_MS) this.cancel(room, "lobby-expired");
        else this.advance(room, now);
      } catch (error) {
        this.recordError(error, room.row.session_id);
        this.cancel(room, "error");
      }
    }
    for (const [stationId, room] of this.lastAtStation) {
      if (room.row.ended_at! + resultDisplayMs > now) continue;
      room.engine?.destroy();
      this.lastAtStation.delete(stationId);
      this.mark();
    }
    for (const { station_id } of this.store.all<{ station_id: string }>("SELECT DISTINCT station_id FROM station_queue")) this.promote(station_id);
    this.flush();
  }
  recordError(error: unknown, scope: string) {
    this.errors++;
    const detail = error instanceof Error ? error.message : String(error);
    this.store.audit("system.error", scope + " · " + detail.slice(0, 300), this.now());
    console.error("[campus]", scope, error);
    this.mark();
  }
  changeTeam(id: string, teamId: string, swapId?: string, admin = false) {
    if (this.store.player(id)?.team_id === teamId) return this.playerView(id);
    if (this.playerStation(id) || (swapId && this.playerStation(swapId))) throw new RequestError("請先讓隊員離開場次及排隊");
    if (!admin && this.store.officialFor(id).length) throw new RequestError("完成正式關卡後由管理員調整隊伍", "team-locked", 403);
    this.store.setTeam(id, teamId, swapId);
    this.store.audit("team.change", id + " · " + teamId + (swapId ? " · " + swapId : ""), this.now());
    this.mark();
    return this.playerView(id);
  }
  autoTeams() {
    if (this.rooms.size || this.store.get("SELECT 1 FROM station_queue LIMIT 1")) throw new RequestError("請先結束場次並清空排隊");
    this.store.autoTeams();
    this.store.audit("team.auto", "依登記順序每五人編隊", this.now());
    this.mark();
  }
  kick(id: string, revoke: boolean) {
    if (!this.store.player(id)) throw new RequestError("找不到玩家", "not-found", 404);
    const socket = this.players.get(id);
    if (revoke) {
      this.store.run("UPDATE players SET token_hash=NULL WHERE player_id=?", id);
      this.leaveStation(id, true);
    }
    socket?.emit("player:kicked", { message: "管理員已中止此手機連線", replaced: false });
    socket?.disconnect(true);
    this.store.audit(revoke ? "player.kick" : "player.link", id, this.now());
    this.mark();
  }
  configureStation(id: string, settings: { name: string; floor?: Floor; x: number; y: number; hostId: string; gameId: string; open: boolean }) {
    const source = this.station(id);
    const target = this.store.stationRows().find(row => row.hostId === settings.hostId)!;
    if (source.gameId !== settings.gameId) throw new RequestError("每個房間的遊戲固定", "fixed-game", 409);
    const reassigned = source.hostId !== settings.hostId;
    if (reassigned && ([source.id, target.id].some(stationId => this.rooms.has(stationId) || this.store.queue(stationId).length))) {
      throw new RequestError("請先清空受影響站點的場次和排隊");
    }
    this.store.transaction(() => {
      this.store.run("UPDATE campus_stations SET station_name=?,floor=?,position_x=?,position_y=?,open=? WHERE station_id=?",
        settings.name, settings.floor ?? source.floor, settings.x, settings.y, Number(settings.open), id);
      if (source.hostId !== settings.hostId) {
        this.store.run("UPDATE campus_stations SET assigned_host_id=NULL WHERE station_id IN (?,?)", id, target.id);
        this.store.run("UPDATE hosts SET station_id=NULL WHERE host_id IN (?,?)", source.hostId, settings.hostId);
        this.store.run("UPDATE campus_stations SET assigned_host_id=? WHERE station_id=?", settings.hostId, id);
        this.store.run("UPDATE campus_stations SET assigned_host_id=? WHERE station_id=?", source.hostId, target.id);
        this.store.run("UPDATE hosts SET station_id=?,assigned_game_id=? WHERE host_id=?", target.id, target.gameId, source.hostId);
      }
      this.store.run("UPDATE hosts SET station_id=?,assigned_game_id=? WHERE host_id=?", id, settings.gameId, settings.hostId);
      this.auditStation("station.configure", id);
    });
    if (reassigned) {
      for (const stationId of new Set([id, target.id])) {
        this.lastAtStation.get(stationId)?.engine?.destroy();
        this.lastAtStation.delete(stationId);
      }
    }
    this.mark();
  }
  private auditStation(action: string, stationId: string) { this.store.audit(action, stationId, this.now()); }
  stationAction(stationId: string, action: "start" | "stop" | "reset" | "clear-queue") {
    const station = this.station(stationId);
    const room = this.rooms.get(stationId);
    this.step();
    const current = this.rooms.get(stationId);
    if (action === "start") {
      if (!station.open || current?.row.status !== "lobby") throw new RequestError("此站沒有可開始的候場場次");
      this.maybeStart(current, true);
    } else if (action === "clear-queue") {
      this.store.run("DELETE FROM station_queue WHERE station_id=?", stationId);
    } else if (current && (!room || current === room)) {
      this.cancel(current, action === "reset" ? "reset" : "stopped");
    } else throw new RequestError("此站目前沒有進行中的場次");
    this.auditStation("station." + action, stationId);
    this.mark();
  }
  resetCompetition() {
    this.store.resetCompetition(this.now());
    for (const room of [...this.rooms.values(), ...this.lastAtStation.values()]) room.engine?.destroy();
    this.rooms.clear();
    this.lastAtStation.clear();
    for (const socket of this.io.sockets.sockets.values()) delete socket.data.stationScan;
    this.mark();
  }
}

