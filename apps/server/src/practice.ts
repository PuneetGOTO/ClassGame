import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { COUNTDOWN_MS, GAME_MS, gameById, VOLLEYBALL_ID } from "../../../packages/shared/catalog";
import { practiceSeats, type PracticeRole, type PracticeSeat, type PracticeView } from "../../../packages/shared/practice";
import { stationQrSchema, type ClientEvents } from "../../../packages/shared/protocol";
import type { PluginFactory } from "../../../packages/game-sdk";
import { SCREEN_RECONNECT_MS } from "../../../packages/shared/rules";
import { Arena, type ArenaResult } from "./arena";
import type { CampusSocket } from "./campus";
import { matchesSecret } from "./config";
import { checkStationQr, qrExpiry, stationQr } from "./station-qr";
import { RequestError } from "./store";

type Input = Parameters<ClientEvents["practice:input"]>[0];
type Round = NonNullable<PracticeView["round"]> & { arena: Arena; pausedMs: number; sequence: Record<PracticeSeat, number> };
type Pairing = { id: string; token: string | null };
const sideOf: Record<PracticeSeat, number> = { P1: 0, P2: 1 };
const bothSides = new Set([0, 1]);
const newPairing = (): Pairing => ({ id: randomUUID(), token: null });

export class Practice {
  private readonly peers = new Map<PracticeRole, CampusSocket>();
  private readonly pairings: Record<PracticeSeat, Pairing> = { P1: newPairing(), P2: newPairing() };
  private gameId = VOLLEYBALL_ID;
  private round?: Round;
  private codeDeadline = 0;

  constructor(
    private readonly plugins: ReadonlyMap<string, PluginFactory>,
    private readonly credentialSecret: string,
    private readonly entry: (origin?: string) => string,
    private readonly now: () => number
  ) {}

  screenKey() {
    return createHmac("sha256", this.credentialSecret).update("campus-practice:screen").digest("base64url");
  }

  private qrScope(seat: PracticeSeat) {
    return "practice:" + seat + ":" + this.pairings[seat].id;
  }

  private controllerToken(socket: CampusSocket, seat: PracticeSeat, credential: string) {
    const pairing = this.pairings[seat];
    if (pairing.token && matchesSecret(credential, pairing.token)) return pairing.token;

    const screen = this.peers.get("screen");
    if (!screen || !stationQrSchema.safeParse(credential).success) {
      throw new RequestError("測試連線已失效，請掃描大螢幕上 " + seat + " 的 QR Code", "practice-link", 401);
    }
    const check = checkStationQr(this.credentialSecret, this.qrScope(seat), screen.id, this.now(), credential);
    if (check === "expired") throw new RequestError("掃碼已過期，請掃描大螢幕上 " + seat + " 的最新 QR Code", "qr-expired", 403);
    if (check !== "valid") throw new RequestError("入場碼已更換，請掃描大螢幕上 " + seat + " 的最新 QR Code", "practice-link", 401);

    const previous = this.peers.get(seat);
    if (previous === socket && pairing.token) return pairing.token;
    if (previous) {
      throw new RequestError(seat + " 已有手機連線。請掃描另一席的 QR Code，或在大螢幕按「重新配對 " + seat + "」。", "practice-seat-busy", 409);
    }
    pairing.token = randomBytes(32).toString("base64url");
    return pairing.token;
  }

  join(socket: CampusSocket, role: PracticeRole, credential: string, entryOrigin?: string) {
    if (socket.data.hostId || socket.data.playerId || (socket.data.practiceRole && socket.data.practiceRole !== role)) {
      throw new RequestError("請用另一個分頁開啟這個測試入口", "bound", 409);
    }
    const token = role === "screen" ? this.screenKey() : this.controllerToken(socket, role, credential);
    if (role === "screen" && !matchesSecret(credential, token)) {
      throw new RequestError("測試大螢幕連結已失效，請從管理後台重新開啟", "practice-link", 401);
    }
    const previous = this.peers.get(role);
    socket.data.practiceRole = role;
    socket.data.entryOrigin = entryOrigin;
    this.peers.set(role, socket);
    if (previous && previous !== socket) {
      if (role !== "screen") this.round?.arena.clearHeldControls(role);
      previous.emit("practice:replaced", { reason: "reconnected" });
      previous.disconnect(true);
    }
    if (role === "screen" && this.round?.pausedAt != null) this.advance(this.now());
    this.publish(socket);
    return { token, view: this.view(role) };
  }

  leave(socket: CampusSocket) {
    const role = this.role(socket);
    if (role !== "screen") this.pairings[role] = newPairing();
    this.disconnect(socket);
    return null;
  }

  release(socket: CampusSocket, seat: PracticeSeat) {
    if (this.role(socket) !== "screen") throw new RequestError("請在測試大螢幕重新配對手掣", "wrong-client", 403);
    this.pairings[seat] = newPairing();
    const controller = this.peers.get(seat);
    if (controller) {
      controller.emit("practice:replaced", { reason: "released" });
      this.disconnect(controller);
      controller.disconnect(true);
    }
    return this.view("screen");
  }

  disconnect(socket: CampusSocket) {
    const role = socket.data.practiceRole;
    if (!role || this.peers.get(role) !== socket) return;
    if (role === "screen" && this.round && this.round.status !== "finished") {
      const now = this.now();
      this.advance(now);
      if (this.round.status === "countdown" || this.round.status === "running") this.round.pausedAt = now;
    }
    this.round?.arena.clearHeldControls(role === "screen" ? undefined : role);
    this.peers.delete(role);
    delete socket.data.practiceRole;
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
      round: state ? {
        id: state.id, status: state.status, startedAt: state.startedAt + state.pausedMs, deadline: state.deadline,
        winner: state.winner, reason: state.reason, pausedAt: state.pausedAt
      } : null,
      seq: role === "screen" ? 0 : state?.sequence[role] ?? 0,
      ...(role === "screen" ? {
        entries: this.entries(),
        ...((state?.status === "running" ||
          (state?.status === "finished" && state.reason !== "host-offline" && gameById.get(this.gameId)?.sharedArena)) &&
          { panels: [state.arena.panel(0), state.arena.panel(1)] })
      } : { remote: state?.status === "running" ? state.arena.remote(sideOf[role], role, state.pausedMs) : {} })
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
        key: stationQr(this.credentialSecret, this.qrScope(seat), screen.id, expiresAt)
      }).toString();
      return { seat, url: url.href, expiresAt };
    });
  }

  private publish(except?: CampusSocket) {
    for (const [role, socket] of this.peers) {
      if (socket !== except) socket.emit("practice:state", this.view(role));
    }
  }

  select(socket: CampusSocket, gameId: string) {
    const role = this.role(socket);
    if (!this.plugins.has(gameId)) throw new RequestError("找不到這款遊戲", "not-found", 404);
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
    const seats = practiceSeats.map(id => ({ id, side: sideOf[id] }));
    const arena = new Arena(this.plugins.get(this.gameId)!, this.gameId, randomInt(0x1_0000_0000), 1, seats);
    const startedAt = this.now() + COUNTDOWN_MS;
    this.clearRound();
    this.round = {
      id: randomUUID(), arena, status: "countdown", startedAt, deadline: startedAt + GAME_MS,
      winner: null, reason: null, pausedMs: 0, sequence: { P1: 0, P2: 0 }
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
    const gameNow = now - round.pausedMs;
    const change = round.arena.input(sideOf[role], role, action, gameNow - round.startedAt, gameNow);
    round.sequence[role] = seq;
    const result = round.arena.result(bothSides);
    if (result) this.finish(round, result.winner, result.reason);
    if (change.changed || result) this.publish();
    return { seq };
  }

  private finish(round: Round, winner: number | null, reason: ArenaResult["reason"] | "host-offline") {
    round.arena.finish();
    round.status = "finished";
    round.winner = winner;
    round.reason = reason;
    round.pausedAt = undefined;
  }

  private advance(now: number) {
    const round = this.round;
    if (!round || round.status === "finished") return false;
    let changed = false;
    if (round.pausedAt != null) {
      const pause = Math.max(0, now - round.pausedAt);
      if (pause >= SCREEN_RECONNECT_MS) {
        this.finish(round, null, "host-offline");
        return true;
      }
      if (!this.peers.has("screen")) return false;
      round.deadline += pause;
      round.pausedMs += pause;
      round.pausedAt = undefined;
      changed = true;
    }
    const gameNow = now - round.pausedMs;
    if (gameNow < round.startedAt) return changed;
    if (round.status === "countdown") {
      round.arena.start();
      round.status = "running";
      changed = true;
    }
    const time = Math.min(now, round.deadline) - round.pausedMs;
    const online = new Set(practiceSeats.filter(seat => this.peers.has(seat)).map(seat => sideOf[seat]));
    if (round.arena.tick(time - round.startedAt, time, online)) changed = true;
    const result = round.arena.result(bothSides, now >= round.deadline);
    if (!result) return changed;
    this.finish(round, result.winner, result.reason);
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
