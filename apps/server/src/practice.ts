import { createHmac, randomInt, randomUUID } from "node:crypto";
import { COUNTDOWN_MS, GAME_MS, gameById } from "../../../packages/shared/catalog";
import { practiceSeats, type PracticeRole, type PracticeSeat, type PracticeView } from "../../../packages/shared/practice";
import type { ClientEvents } from "../../../packages/shared/protocol";
import type { PluginFactory } from "../../../packages/game-sdk";
import { Arena } from "./arena";
import type { CampusSocket } from "./campus";
import { matchesSecret } from "./config";
import { checkStationQr, qrExpiry, stationQr } from "./station-qr";
import { RequestError } from "./store";

type Input = Parameters<ClientEvents["practice:input"]>[0];
type Round = NonNullable<PracticeView["round"]> & { arena: Arena; sequence: Record<PracticeSeat, number> };
const sideOf: Record<PracticeSeat, number> = { P1: 0, P2: 1 };
const bothSides = new Set([0, 1]);

export class Practice {
  private readonly peers = new Map<PracticeRole, CampusSocket>();
  private gameId = "game-19";
  private round?: Round;
  private codeDeadline = 0;

  constructor(
    private readonly plugins: ReadonlyMap<string, PluginFactory>,
    private readonly credentialSecret: string,
    private readonly entry: (origin?: string) => string,
    private readonly now: () => number
  ) {}

  key(role: PracticeRole) {
    return createHmac("sha256", this.credentialSecret).update("campus-practice:" + role).digest("base64url");
  }

  join(socket: CampusSocket, role: PracticeRole, credential: string, entryOrigin?: string) {
    const token = this.key(role);
    if (!matchesSecret(credential, token)) {
      const screen = this.peers.get("screen");
      if (role === "screen" || !screen) throw new RequestError("測試登入連結無效", "practice-link", 401);
      const check = checkStationQr(this.credentialSecret, "practice:" + role, screen.id, this.now(), credential);
      if (check === "expired") throw new RequestError("掃碼已過期，請掃描測試大螢幕上的最新 QR Code", "qr-expired", 403);
      if (check !== "valid") throw new RequestError("測試登入連結無效", "practice-link", 401);
    }
    if (socket.data.hostId || socket.data.playerId || (socket.data.practiceRole && socket.data.practiceRole !== role)) {
      throw new RequestError("請用另一個分頁開啟這個測試入口", "bound", 409);
    }
    const previous = this.peers.get(role);
    socket.data.practiceRole = role;
    socket.data.entryOrigin = entryOrigin;
    this.peers.set(role, socket);
    if (previous && previous !== socket) {
      previous.emit("practice:replaced", null);
      previous.disconnect(true);
    }
    this.publish(socket);
    return { token, view: this.view(role) };
  }

  disconnect(socket: CampusSocket) {
    const role = socket.data.practiceRole;
    if (!role || this.peers.get(role) !== socket) return;
    this.peers.delete(role);
    this.publish();
  }

  private role(socket: CampusSocket) {
    const role = socket.data.practiceRole;
    if (!role || this.peers.get(role) !== socket) throw new RequestError("請先登入測試房", "unauthorized", 401);
    return role;
  }

  private view(role: PracticeRole): PracticeView {
    const state = this.round;
    return {
      role, gameId: this.gameId, screenOnline: this.peers.has("screen"),
      seats: { P1: this.peers.has("P1"), P2: this.peers.has("P2") },
      round: state ? { id: state.id, status: state.status, startedAt: state.startedAt, deadline: state.deadline, winner: state.winner } : null,
      seq: role === "screen" ? 0 : state?.sequence[role] ?? 0,
      ...(role === "screen" ? {
        entries: this.entries(),
        ...(state?.status === "running" && { panels: [state.arena.panel(0), state.arena.panel(1)] })
      } : { remote: state?.status === "running" ? state.arena.remote(sideOf[role]) : {} })
    };
  }

  private entries() {
    const screen = this.peers.get("screen");
    if (!screen) return [];
    const expiresAt = qrExpiry(this.now());
    return practiceSeats.map(seat => {
      const url = new URL("/practice", this.entry(screen.data.entryOrigin));
      url.searchParams.set("role", seat);
      url.hash = new URLSearchParams({
        key: stationQr(this.credentialSecret, "practice:" + seat, screen.id, expiresAt)
      }).toString();
      return { seat, url: url.href };
    });
  }

  private publish(except?: CampusSocket) {
    for (const [role, socket] of this.peers) {
      if (socket !== except) socket.emit("practice:state", this.view(role));
    }
  }

  select(socket: CampusSocket, gameId: string) {
    const role = this.role(socket);
    if (!gameById.has(gameId) || !this.plugins.has(gameId)) throw new RequestError("找不到這款遊戲", "not-found", 404);
    if (gameId === this.gameId) return this.view(role);
    if (this.round && this.round.status !== "finished") {
      throw new RequestError("請先結束這一局再換遊戲", "in-progress", 409);
    }
    this.clearRound();
    this.gameId = gameId;
    this.publish(socket);
    return this.view(role);
  }

  start(socket: CampusSocket) {
    const role = this.role(socket);
    if (this.round && this.round.status !== "finished") return this.view(role);
    if (!this.peers.has("screen") || !practiceSeats.every(seat => this.peers.has(seat))) {
      throw new RequestError("開啟測試大螢幕並連上兩支手掣後即可開始", "not-ready", 409);
    }
    const arena = new Arena(this.plugins.get(this.gameId)!, this.gameId, randomInt(0x1_0000_0000), 1, [0, 1]);
    const startedAt = this.now() + COUNTDOWN_MS;
    this.clearRound();
    this.round = {
      id: randomUUID(), arena, status: "countdown", startedAt, deadline: startedAt + GAME_MS,
      winner: null, sequence: { P1: 0, P2: 0 }
    };
    this.publish(socket);
    return this.view(role);
  }

  stop(socket: CampusSocket) {
    const role = this.role(socket);
    this.clearRound();
    this.publish(socket);
    return this.view(role);
  }

  private clearRound() {
    this.round?.arena.destroy();
    this.round = undefined;
  }

  input(socket: CampusSocket, { sessionId, seq, action }: Input) {
    const role = this.role(socket);
    if (role === "screen") throw new RequestError("請用手機手掣操作", "wrong-client", 403);
    const now = this.now();
    if (this.advance(now)) this.publish();
    const round = this.round;
    if (!round || round.status !== "running" || sessionId !== round.id) {
      throw new RequestError("此測試場次已結束", "not-running", 409);
    }
    if (!this.peers.has("screen")) throw new RequestError("請讓測試大螢幕重新連線", "host-offline", 409);
    if (seq <= round.sequence[role]) return { seq: round.sequence[role] };
    round.sequence[role] = seq;
    const change = round.arena.input(sideOf[role], action, now - round.startedAt, now);
    const winner = round.arena.completed(bothSides);
    if (winner !== null) this.finish(round, winner);
    if (change.changed || winner !== null) this.publish();
    return { seq };
  }

  private finish(round: Round, winner: number | null) {
    round.arena.finish();
    round.status = "finished";
    round.winner = winner;
  }

  private advance(now: number) {
    const round = this.round;
    if (!round || round.status === "finished" || now < round.startedAt) return false;
    let changed = round.status === "countdown";
    if (changed) {
      round.arena.start();
      round.status = "running";
    }
    const time = Math.min(now, round.deadline);
    const online = new Set(practiceSeats.filter(seat => this.peers.has(seat)).map(seat => sideOf[seat]));
    if (round.arena.tick(time - round.startedAt, time, online)) changed = true;
    if (now >= round.deadline) {
      this.finish(round, round.arena.winner(bothSides));
      return true;
    }
    const winner = round.arena.completed(bothSides);
    if (winner === null) return changed;
    this.finish(round, winner);
    return true;
  }

  step() {
    const now = this.now();
    if (this.advance(now)) this.publish();
    const deadline = qrExpiry(now);
    if (deadline === this.codeDeadline) return;
    this.codeDeadline = deadline;
    this.peers.get("screen")?.emit("practice:state", this.view("screen"));
  }
}
