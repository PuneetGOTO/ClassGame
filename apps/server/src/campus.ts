import { randomInt, randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { COUNTDOWN_MS, GAME_MS, GAMES } from "../../../packages/shared/catalog";
import { floorLabel, type Floor } from "../../../packages/shared/floors";
import { DOUBLE_END_MS, DOUBLE_START_MS, MATCH_ARRIVAL_MS, MIN_MATCH_PLAYERS, STATION_SCAN_GRANT_MS } from "../../../packages/shared/rules";
import { ROUTE_LENGTH, routeTier, type Difficulty } from "../../../packages/shared/route";
import type {
  AdminState, CampusState, ClientEvents, EndReason, HostView, PlayerView, RoomView, ServerEvents, StationEntry, StationView
} from "../../../packages/shared/protocol";
import { shuffled, type PluginFactory } from "../../../packages/game-sdk";
import { settle, type Outcome } from "./scoring";
import { RequestError, Store, type MemberRow, type MatchTicket, type SessionRow } from "./store";
import { checkStationQr, qrExpiry, stationQr } from "./station-qr";
import { Arena, matchMode } from "./arena";
import { selectMatch, type MatchChoice } from "./matchmaking";

export type PeerData = { playerId?: string; hostId?: string; entryOrigin?: string;
  stationScan?: { stationId: string; hostConnection: string; expiresAt: number } };
export type CampusSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, PeerData>;
export type CampusIO = Server<ClientEvents, ServerEvents, Record<string, never>, PeerData>;
interface Room { row: SessionRow; members: Map<string, MemberRow>; arena?: Arena }
const resultDisplayMs = 5000;

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
  private nextMatchAt = 0;

  constructor(
    readonly store: Store,
    private io: CampusIO,
    private plugins: ReadonlyMap<string, PluginFactory>,
    private entry: (origin?: string, station?: string) => string,
    private qrSecret: string,
    readonly now: () => number = Date.now
  ) {
    this.leader = store.leaderboard();
    const rows = this.store.all<SessionRow>(`SELECT * FROM game_sessions WHERE competition_id=? AND match_tier>0 AND
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
    return this.memberRoom(playerId)?.row.station_id ?? null;
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
        ...game, mode: "versus", enabled: Boolean(this.store.get<{ enabled: number }>("SELECT enabled FROM games WHERE game_id=?", game.id)?.enabled)
      })),
      leaderboard: this.leader, floorMaps: this.store.mapStatus(), doubleChance: this.store.doubleChance()
    };
  }
  private roomView(room: Room, viewer?: string): RoomView {
    const { row, arena, members } = room;
    const playing = row.status === "running" || row.status === "finished";
    const member = viewer ? members.get(viewer) : undefined;
    const sides = [...new Set([...members.values()].flatMap(item => item.side === null ? [] : [item.side]))].sort();
    const doubleMember = row.double_player_id ? members.get(row.double_player_id) : undefined;
    return {
      id: row.session_id, gameId: row.game_id, hostId: row.host_id, stationId: row.station_id, teamId: row.team_id,
      startedAt: row.started_at, deadline: row.deadline, round: row.round_no, status: row.status, reason: row.reason, now: this.now(),
      seq: member?.last_seq ?? 0,
      course: member ? { step: member.route_step, tier: routeTier(member.route_step) } : null,
      doubleChallenge: doubleMember && row.double_started_at != null ? {
        playerId: doubleMember.player_id, playerName: this.store.player(doubleMember.player_id)!.player_name,
        startedAt: row.double_started_at, tier: routeTier(doubleMember.route_step)
      } : null,
      members: [...members.values()].map((item, index) => {
        const player = this.store.player(item.player_id)!;
        return {
          id: player.player_id, name: player.player_name, connected: Boolean(player.connected),
          ready: Boolean(item.ready), participated: Boolean(item.participated), forfeited: Boolean(item.forfeited),
          checkedIn: Boolean(item.checked_in), position: index + 1, side: item.side, tint: item.side ?? index,
          progress: playing && item.side !== null ? arena?.panel(item.side, false).progress ?? undefined : undefined
        };
      }),
      scene: null, progress: playing && member?.side != null ? arena?.panel(member.side, false).progress ?? null : null,
      match: {
        mode: matchMode(members.size), arrivalDeadline: row.created_at + MATCH_ARRIVAL_MS, winner: row.winner_side ?? null,
        ...(viewer
          ? { remote: playing && member?.side != null ? arena?.remote(member.side) ?? {} : {} }
          : { panels: playing ? sides.map(side => arena!.panel(side)) : [] })
      }
    };
  }
  playerView(id: string): PlayerView {
    const row = this.store.player(id);
    if (!row) throw new RequestError("找不到玩家", "not-found", 404);
    const room = this.memberRoom(id);
    const seat = room?.members.get(id);
    const lastResult = this.store.recentFor(id);
    const results = this.store.officialFor(id);
    const searching = Boolean(this.store.get("SELECT 1 FROM match_search WHERE player_id=?", id));
    return {
      player: this.store.publicPlayer(row), teamRank: this.leader.teams.find(t => t.id === row.team_id)?.rank ?? 0,
      results, queue: null,
      route: { completed: Math.min(results.length, ROUTE_LENGTH), searching, next: room && seat ? {
        step: seat.route_step, gameId: room.row.game_id, stationId: room.row.station_id, tier: routeTier(seat.route_step)
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
    if (socket.data.playerId) this.checkReservation(socket.data.playerId, station);
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
  private checkReservation(id: string, station: StationView) {
    const room = this.memberRoom(id);
    if (!room) {
      if (this.store.playedGames(id).length >= ROUTE_LENGTH) throw new RequestError("你已完成全部 10 關", "course-complete", 409);
      throw new RequestError("請先在手機上尋找對手，配對後再到指定房間掃碼", "no-match", 409);
    }
    if (room.row.station_id !== station.id) {
      const assigned = this.station(room.row.station_id);
      throw new RequestError("本場請前往" + floorLabel[assigned.floor] + " " + assigned.name + "掃碼", "wrong-route", 403);
    }
    if (room.row.status === "lobby" && this.now() >= room.row.created_at + MATCH_ARRIVAL_MS) {
      throw new RequestError("本站報到時間已到，請等候重新配對", "lobby-expired", 409);
    }
    return room;
  }

  findMatch(id: string) {
    if (this.memberRoom(id)) return this.playerView(id);
    if (this.store.playedGames(id).length >= ROUTE_LENGTH) throw new RequestError("你已完成全部 10 關", "course-complete", 409);
    this.store.run("INSERT OR IGNORE INTO match_search(player_id,queued_at) VALUES (?,?)", id, this.now());
    this.mark();
    return this.playerView(id);
  }

  enterStation(socket: CampusSocket, stationId: string) {
    const id = this.playerId(socket);
    const station = this.station(stationId);
    const room = this.checkReservation(id, station);
    const member = room.members.get(id)!;
    if (member.checked_in) return this.playerView(id);
    if (!station.open || !station.online) throw new RequestError("此站暫停入場", "station-closed", 409);
    const scan = socket.data.stationScan;
    if (!scan || scan.stationId !== stationId || scan.hostConnection !== this.hosts.get(station.hostId)?.id || scan.expiresAt <= this.now()) {
      throw new RequestError("請到房間掃描大螢幕上的最新 QR Code", "scan-required", 403);
    }
    this.store.run("UPDATE session_members SET checked_in=1 WHERE session_id=? AND player_id=?", room.row.session_id, id);
    member.checked_in = 1;
    delete socket.data.stationScan;
    this.mark();
    return this.playerView(id);
  }

  leaveStation(id: string, admin = false) {
    const room = this.memberRoom(id);
    if (room && room.row.status !== "lobby") {
      if (!admin) throw new RequestError("本場已開始，請等候結算", "in-progress", 409);
      this.store.run("UPDATE session_members SET forfeited=1 WHERE session_id=? AND player_id=?", room.row.session_id, id);
      room.members.get(id)!.forfeited = 1;
    } else if (room) {
      this.store.run("DELETE FROM session_members WHERE session_id=? AND player_id=?", room.row.session_id, id);
      room.members.delete(id);
      if (room.members.size < MIN_MATCH_PLAYERS) this.cancel(room, "forfeit", true);
      else this.maybeStart(room);
    }
    this.store.run("DELETE FROM match_search WHERE player_id=?", id);
    const socket = this.players.get(id);
    if (socket) delete socket.data.stationScan;
    this.mark();
    return this.playerView(id);
  }

  private matchPlayers(now: number) {
    if (now < this.nextMatchAt) return;
    this.nextMatchAt = now + 500;
    const tickets = this.store.all<MatchTicket>("SELECT * FROM match_search ORDER BY queued_at, rowid");
    if (tickets.length < MIN_MATCH_PLAYERS) return;
    let rooms = this.store.stationRows().filter(station =>
      station.open && station.online && !this.rooms.has(station.id) && !this.lastAtStation.has(station.id) &&
      this.store.get<{ enabled: number }>("SELECT enabled FROM games WHERE game_id=?", station.gameId)?.enabled
    );
    if (!rooms.length) return;
    let waiting = tickets.flatMap(ticket => {
      if (!this.players.has(ticket.player_id) || this.memberRoom(ticket.player_id)) return [];
      const played = this.store.playedGames(ticket.player_id);
      if (played.length >= ROUTE_LENGTH) return [];
      return [{
        id: ticket.player_id, step: played.length + 1, queuedAt: ticket.queued_at,
        games: new Set(played.map(game => game.gameId)), lastFloor: played[0]?.floor ?? null
      }];
    });
    while (rooms.length && waiting.length >= MIN_MATCH_PLAYERS) {
      const match = selectMatch(waiting, rooms, now);
      if (!match) break;
      this.reserveMatch(match, now);
      rooms = rooms.filter(station => station.id !== match.stationId);
      waiting = waiting.filter(player => !match.players.includes(player));
    }
  }

  private reserveMatch(match: MatchChoice, now: number) {
    const station = this.station(match.stationId);
    const matchTier = Math.max(...match.players.map(player => routeTier(player.step))) as Difficulty;
    const row: SessionRow = {
      session_id: randomUUID(), competition_id: this.store.competitionId, game_id: station.gameId, station_id: station.id,
      host_id: station.hostId, team_id: null, round_no: 1, created_at: now, started_at: null, deadline: null,
      ended_at: null, status: "lobby", reason: null, seed: randomInt(0x1_0000_0000), engine_state: null, roster: "[]",
      double_due_at: null, double_player_id: null, double_started_at: null, match_tier: matchTier, winner_side: null
    };
    const members = new Map<string, MemberRow>();
    this.store.transaction(() => {
      this.store.run("INSERT INTO game_sessions(session_id,competition_id,game_id,station_id,host_id,round_no,created_at,status,seed,match_tier) VALUES (?,?,?,?,?,1,?,'lobby',?,?)",
        row.session_id, row.competition_id, row.game_id, row.station_id, row.host_id, now, row.seed, matchTier);
      for (const player of match.players) {
        const teamId = this.store.player(player.id)!.team_id;
        this.store.run("INSERT INTO session_members(session_id,player_id,team_id,route_step) VALUES (?,?,?,?)",
          row.session_id, player.id, teamId, player.step);
        this.store.run("DELETE FROM match_search WHERE player_id=?", player.id);
        members.set(player.id, {
          player_id: player.id, team_id: teamId, ready: 0, participated: 0, forfeited: 0, last_seq: 0, won_at: null,
          played: 0, checked_in: 0, side: null, route_step: player.step
        });
      }
    });
    this.rooms.set(station.id, { row, members });
    this.mark();
  }

  ready(id: string, sessionId: string, ready: boolean) {
    const room = this.memberRoom(id);
    if (!room || room.row.session_id !== sessionId) throw new RequestError("你尚未加入這個場次", "wrong-session", 403);
    if (room.row.status !== "lobby") return this.playerView(id);
    if (this.now() >= room.row.created_at + MATCH_ARRIVAL_MS) throw new RequestError("本站報到時間已到", "lobby-expired", 409);
    const member = room.members.get(id)!;
    if (!member.checked_in) throw new RequestError("到指定房間掃碼後即可準備", "scan-required", 403);
    this.store.run("UPDATE session_members SET ready=? WHERE session_id=? AND player_id=?", Number(ready), sessionId, id);
    member.ready = Number(ready);
    this.maybeStart(room);
    this.mark();
    return this.playerView(id);
  }

  private maybeStart(room: Room, force = false) {
    const { row } = room;
    if (!this.hosts.has(row.host_id)) return false;
    const ready = shuffled([...room.members.values()].filter(member =>
      member.checked_in && member.ready && this.players.has(member.player_id)), randomInt);
    if (ready.length < MIN_MATCH_PLAYERS || (!force && ready.length < room.members.size)) return false;
    const absent = [...room.members.values()].filter(member => !ready.includes(member));
    const participants = ready.map(member => member.player_id);
    const sides = ready.map((_, i) => ready.length === 4 ? i % 2 : i);
    const factory = this.plugins.get(row.game_id);
    if (!factory) throw new RequestError("此關插件尚未啟用", "plugin-unavailable", 409);
    const arena = new Arena(factory, row.game_id, row.seed, row.match_tier as Difficulty, sides);
    const startedAt = this.now() + COUNTDOWN_MS;
    const deadline = startedAt + GAME_MS;
    const due = randomInt(100) < this.store.doubleChance() ? startedAt + randomInt(DOUBLE_START_MS, DOUBLE_END_MS + 1) : null;
    const engineState = arena.serialize();
    this.store.transaction(() => {
      for (const [index, member] of ready.entries()) {
        this.store.run("UPDATE session_members SET participated=1,side=? WHERE session_id=? AND player_id=?",
          sides[index], row.session_id, member.player_id);
      }
      for (const member of absent) {
        this.store.run("DELETE FROM session_members WHERE session_id=? AND player_id=?", row.session_id, member.player_id);
        if (member.checked_in && this.players.has(member.player_id)) {
          this.store.run("INSERT OR IGNORE INTO match_search(player_id,queued_at) VALUES (?,?)", member.player_id, this.now());
        }
      }
      this.store.run("UPDATE game_sessions SET status='countdown',started_at=?,deadline=?,roster=?,engine_state=?,double_due_at=? WHERE session_id=?",
        startedAt, deadline, JSON.stringify(participants), engineState, due, row.session_id);
    });
    for (const [index, member] of ready.entries()) Object.assign(member, { participated: 1, side: sides[index] });
    for (const member of absent) room.members.delete(member.player_id);
    Object.assign(row, { status: "countdown", started_at: startedAt, deadline, roster: JSON.stringify(participants),
      engine_state: engineState, double_due_at: due });
    room.arena = arena;
    this.pushRoom(room, "game:start");
    this.mark();
    return true;
  }

  private restoreEngine(room: Room) {
    const { row, members } = room;
    const factory = this.plugins.get(row.game_id);
    if (!factory) throw new Error("Missing plugin " + row.game_id);
    const sides = [...members.values()].flatMap(member => member.side === null ? [] : [member.side]);
    room.arena = new Arena(factory, row.game_id, row.seed, row.match_tier as Difficulty, sides, row.engine_state);
  }

  private checkpoint(room: Room, sequence?: { member: MemberRow; seq: number; played: boolean }) {
    const engineState = room.arena!.serialize();
    this.store.transaction(() => {
      this.store.run("UPDATE game_sessions SET engine_state=? WHERE session_id=?", engineState, room.row.session_id);
      if (sequence) this.store.run("UPDATE session_members SET last_seq=?, played=MAX(played,?) WHERE session_id=? AND player_id=?",
        sequence.seq, Number(sequence.played), room.row.session_id, sequence.member.player_id);
    });
    room.row.engine_state = engineState;
    if (sequence) Object.assign(sequence.member, { last_seq: sequence.seq, played: sequence.member.played || Number(sequence.played) });
  }

  private playedSides(room: Room, onlineOnly = false) {
    return new Set([...room.members.values()].flatMap(member => member.side !== null && member.played &&
      (!onlineOnly || (!member.forfeited && this.players.has(member.player_id))) ? [member.side] : []));
  }

  private checkGoal(room: Room, now: number) {
    const sides = this.playedSides(room);
    if (sides.size < MIN_MATCH_PLAYERS) return false;
    const winner = room.arena!.completed(this.playedSides(room, true));
    if (winner === null) return false;
    this.finish(room, "goal", now, winner);
    return true;
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
    if (room.row.status !== "running" || member.side === null || !member.participated || member.forfeited) {
      throw new RequestError("目前不能操作此場次", "not-running", 409);
    }
    if (!this.hosts.has(room.row.host_id)) throw new RequestError("正在等候房間大螢幕重新連線", "host-offline", 409);
    const change = room.arena!.input(member.side, action, now - room.row.started_at!, now);
    if (change.changed) {
      this.checkpoint(room, { member, seq, played: change.played });
      if (!this.checkGoal(room, now)) this.pushRoom(room);
    } else {
      this.store.run("UPDATE session_members SET last_seq=? WHERE session_id=? AND player_id=?", seq, sessionId, id);
      member.last_seq = seq;
    }
    return { seq };
  }

  private advance(room: Room, now: number) {
    const { row, arena } = room;
    if (row.status === "countdown" && now >= row.started_at!) {
      arena!.start();
      const state = arena!.serialize();
      this.store.run("UPDATE game_sessions SET status='running',engine_state=? WHERE session_id=?", state, row.session_id);
      Object.assign(row, { status: "running", engine_state: state });
      this.mark();
      if (now < row.deadline!) this.pushRoom(room);
    }
    if (row.status !== "running") return;
    const end = Math.min(now, row.deadline!);
    if (!this.hosts.has(row.host_id)) {
      if (now >= row.deadline!) this.cancel(room, "host-offline", true);
      return;
    }
    const online = new Set([...room.members.values()].flatMap(member =>
      member.side !== null && !member.forfeited && this.players.has(member.player_id) ? [member.side] : []));
    const changed = arena!.tick(end - row.started_at!, end, online);
    if (changed) this.checkpoint(room);
    if (now >= row.deadline!) {
      if (this.playedSides(room).size < MIN_MATCH_PLAYERS) this.cancel(room, "no-play", true);
      else this.finish(room, "timeout", end, arena!.winner(this.playedSides(room, true)));
      return;
    }
    this.maybeRevealDouble(room, now);
    if (changed) this.pushRoom(room);
    this.checkGoal(room, now);
  }

  private maybeRevealDouble(room: Room, now: number) {
    const { row, members, arena } = room;
    if (row.double_due_at == null || row.double_player_id || now < row.double_due_at || row.deadline! - now < 5000) return;
    if (this.playedSides(room).size < MIN_MATCH_PLAYERS) return;
    const candidates = [...members.values()].filter(member =>
      member.participated && member.played && !member.forfeited && member.side !== null &&
      this.players.has(member.player_id) && !arena!.panel(member.side, false).cleared);
    if (!candidates.length) return;
    const member = candidates[randomInt(candidates.length)];
    const change = this.store.run("UPDATE game_sessions SET double_player_id=?,double_started_at=? WHERE session_id=? AND status='running' AND double_player_id IS NULL",
      member.player_id, now, row.session_id);
    if (Number(change.changes) !== 1) return;
    Object.assign(row, { double_player_id: member.player_id, double_started_at: now });
    const challenge = { playerId: member.player_id, playerName: this.store.player(member.player_id)!.player_name,
      startedAt: now, tier: routeTier(member.route_step) };
    const event = { sessionId: row.session_id, challenge };
    for (const id of members.keys()) this.players.get(id)?.emit("game:double-challenge", event);
    this.hosts.get(row.host_id)?.emit("game:double-challenge", event);
    this.pushRoom(room);
  }

  private finish(room: Room, reason: EndReason, now: number, winner: number | null) {
    const { row, members, arena } = room;
    arena!.finish();
    const outcomes: Outcome[] = [...members.values()].map(member => {
      const participated = Boolean(member.participated && member.played);
      const side = member.side!;
      const won = Boolean(participated && winner === side && !member.forfeited && this.players.has(member.player_id));
      const { scene, progress } = arena!.panel(side, participated);
      return {
        playerId: member.player_id, teamId: member.team_id, participated, won, step: member.route_step,
        duration: participated ? now - row.started_at! : 0,
        metrics: participated ? {
          progress: progress ?? undefined,
          ...(scene?.kind === "quiz" ? { attempted: scene.attempted, correct: scene.correct } : {})
        } : undefined
      };
    });
    if (!settle(this.store, row, outcomes, reason, now, winner)) return;
    Object.assign(row, { status: "finished", ended_at: now, reason, winner_side: winner });
    this.rooms.delete(row.station_id);
    this.lastAtStation.set(row.station_id, room);
    this.pushRoom(room, reason === "timeout" ? "game:timeout" : "game:finish");
    for (const result of this.store.resultsForSession(row.session_id)) {
      this.players.get(result.playerId)?.emit("score:result", result);
      this.hosts.get(row.host_id)?.emit("score:result", result);
      if (!result.participated) this.players.get(result.playerId)?.emit("system:error", {
        error: "這場沒有完成有效操作。請重新配對挑戰這一關。", code: "no-play"
      });
    }
    this.mark();
  }

  private cancel(room: Room, reason: EndReason, requeue = false) {
    const { row } = room;
    const now = this.now();
    this.store.transaction(() => {
      this.store.run("UPDATE game_sessions SET status='cancelled',ended_at=?,reason=? WHERE session_id=?", now, reason, row.session_id);
      if (!requeue) return;
      for (const member of room.members.values()) {
        const eligible = member.checked_in && this.players.has(member.player_id) && !member.forfeited;
        if (eligible && (reason !== "no-play" || member.played)) {
          this.store.run("INSERT OR IGNORE INTO match_search(player_id,queued_at) VALUES (?,?)", member.player_id, now);
        }
      }
    });
    Object.assign(row, { status: "cancelled", reason });
    this.rooms.delete(row.station_id);
    this.pushRoom(room, "game:finish");
    const notice = reason === "no-play" ? "本場沒有兩方完成操作。已操作的玩家會重新配對。"
      : reason === "lobby-expired" ? "候場人數不足，已報到的玩家會重新配對。"
      : reason === "host-offline" ? "房間大螢幕未恢復連線，已報到的玩家會重新配對。"
      : null;
    if (notice) {
      for (const id of room.members.keys()) this.players.get(id)?.emit("system:error", { error: notice, code: reason });
    }
    room.arena?.destroy();
    this.mark();
  }

  step() {
    const now = this.now();
    this.rotateEntries(now);
    for (const room of this.rooms.values()) {
      try {
        if (room.row.status === "lobby" && now - room.row.created_at >= MATCH_ARRIVAL_MS) {
          if (!this.maybeStart(room, true)) this.cancel(room, "lobby-expired", true);
        } else this.advance(room, now);
      } catch (error) {
        this.recordError(error, room.row.session_id);
        this.cancel(room, "error");
      }
    }
    for (const [stationId, room] of this.lastAtStation) {
      if (room.row.ended_at! + resultDisplayMs > now) continue;
      room.arena?.destroy();
      this.lastAtStation.delete(stationId);
      this.mark();
    }
    this.matchPlayers(now);
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
    if (this.rooms.size || this.store.get("SELECT 1 FROM match_search LIMIT 1")) throw new RequestError("請先結束場次並清空配對");
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
    if (reassigned && ([source.id, target.id].some(stationId => this.rooms.has(stationId)))) {
      throw new RequestError("請先結束受影響站點的場次");
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
        this.lastAtStation.get(stationId)?.arena?.destroy();
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
      if (!this.maybeStart(current, true)) throw new RequestError("至少兩位已到場的在線玩家就緒才可開始", "not-ready", 409);
    } else if (action === "clear-queue") {
      if (current?.row.status === "lobby") this.cancel(current, "stopped");
    } else if (current && (!room || current === room)) {
      this.cancel(current, action === "reset" ? "reset" : "stopped");
    } else throw new RequestError("此站目前沒有進行中的場次");
    this.auditStation("station." + action, stationId);
    this.mark();
  }
  resetCompetition() {
    this.store.resetCompetition(this.now());
    for (const room of [...this.rooms.values(), ...this.lastAtStation.values()]) room.arena?.destroy();
    this.rooms.clear();
    this.lastAtStation.clear();
    for (const socket of this.io.sockets.sockets.values()) delete socket.data.stationScan;
    this.mark();
  }
}

