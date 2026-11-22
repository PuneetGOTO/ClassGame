import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import type { Ack, Action, ClientEvents, ServerEvents } from "../packages/shared/protocol";
import { hostKey } from "../apps/server/src/config";
import { createService } from "../apps/server/src/service";
import { plugins } from "../local-games/registry";

export type Client = Socket<ServerEvents, ClientEvents>;
export const credentials = { adminKey: "unit-test-admin-key-priv", hostSecret: "unit-test-host-secret-priv" };
export type Event = keyof ClientEvents;
type Data<E extends Event> = NonNullable<Parameters<ClientEvents[E]>[1]> extends (result: Ack<infer T>) => void ? T : never;

export async function send<E extends Event>(client: Client, event: E, payload: Parameters<ClientEvents[E]>[0]): Promise<Ack<Data<E>>> {
  const emitter = client.timeout(5000) as unknown as { emitWithAck(name: string, body: unknown): Promise<Ack<Data<E>>> };
  return emitter.emitWithAck(event, payload);
}
export async function ok<E extends Event>(client: Client, event: E, payload: Parameters<ClientEvents[E]>[0]) {
  const result = await send(client, event, payload);
  if (!result.ok) assert.fail(result.error);
  return result.data;
}
export async function harness(dbPath = ":memory:", start = 100_000, realTime = false) {
  let time = start;
  const now = realTime ? Date.now : () => time;
  const service = createService({ ...credentials, dbPath }, plugins, { autoTick: realTime, now });
  service.store.run("UPDATE settings SET double_chance=0");
  const port = await service.listen(0, "127.0.0.1");
  const origin = "http://127.0.0.1:" + port;
  const clients = new Set<Client>();
  const connect = () => new Promise<Client>((resolve, reject) => {
    const client: Client = io(origin, { transports: ["websocket"], forceNew: true, reconnection: false });
    clients.add(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
  async function host(id: string) {
    const client = await connect();
    await ok(client, "host:register", { hostId: id, key: hostKey(credentials.hostSecret, id), entryOrigin: origin });
    return client;
  }
  function stationCode(stationId: string) {
    const station = service.store.stationRows().find(item => item.id === stationId);
    const entry = station && service.campus.hostView(station.hostId, origin).entry;
    assert.ok(entry, "Station host must be online for " + stationId);
    return scanCode(entry.url);
  }
  async function attemptStation(client: Client, stationId: string) {
    const scanCurrent = () => send(client, "station:scan", { stationId, code: stationCode(stationId) });
    let scan = await scanCurrent();
    if (!scan.ok && scan.code === "qr-expired") scan = await scanCurrent();
    if (!scan.ok) return scan;
    return send(client, "station:join", { stationId });
  }
  async function joinStation(client: Client, stationId: string) {
    const result = await attemptStation(client, stationId);
    if (!result.ok) assert.fail(result.error);
    return result.data;
  }
  async function player(name: string, teamId?: string) {
    const socket = await connect();
    const { token, state } = await ok(socket, "player:join", { name, teamId });
    return { socket, token, id: state.player.id, state };
  }
  async function operate(client: Client, id: string) {
    const room = service.campus.playerView(id).room!;
    const scene = room.scene!;
    assert.equal(room.status, "running");
    let inputs: Action[] = ["up", "right", "down", "left"].map(direction =>
      ({ kind: "move", direction: direction as "up" | "right" | "down" | "left" }));
    if (scene.kind === "grid") {
      const index = scene.tiles.findIndex(tile => tile.action);
      if (index >= 0) inputs = [{ kind: "cell", index }];
    } else if (scene.kind === "tubes") {
      inputs = [{ kind: "cell", index: scene.tubes.findIndex(tube => tube.length) }];
    } else if (scene.kind === "quiz") {
      const question = scene.prompt!;
      inputs = [{ kind: "answer", questionId: question.id, value: question.options?.[0].value ?? "1" }];
    } else if (scene.theme !== "road") {
      inputs = [{ kind: "action", action: scene.theme === "space" ? "shoot" : "jump" }];
    }
    for (const [i, action] of inputs.entries()) {
      await ok(client, "game:input", { sessionId: room.id, seq: room.seq + 1 + i, action });
      if (service.store.get<{ played: number }>("SELECT played FROM session_members WHERE session_id=? AND player_id=?", room.id, id)!.played) return;
    }
    assert.fail("No valid input registered for " + room.gameId);
  }
  function fixtureRoute(playerId: string, ...prefix: string[]) {
    const competition = service.store.competitionId;
    const route = service.store.all<{ game_id: string; seed: number }>(`SELECT game_id,seed FROM player_routes
      WHERE competition_id=? AND player_id=? ORDER BY step`, competition, playerId);
    const ordered = prefix.map(gameId => route.find(entry => entry.game_id === gameId)!)
      .concat(route.filter(entry => !prefix.includes(entry.game_id)));
    assert.equal(new Set(ordered.map(entry => entry.game_id)).size, 20);
    service.store.transaction(() => {
      service.store.run("DELETE FROM player_routes WHERE competition_id=? AND player_id=?", competition, playerId);
      for (const [index, entry] of ordered.entries()) {
        service.store.run(`INSERT INTO player_routes(competition_id,player_id,step,game_id,seed) VALUES (?,?,?,?,?)`,
          competition, playerId, index + 1, entry.game_id, entry.seed);
      }
    });
  }
  function step(delta = 0) { time += delta; service.campus.step(); }
  async function admin(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    return fetch(origin + "/api/admin" + path, {
      method, headers: { Authorization: "Bearer " + credentials.adminKey, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }
  async function close() {
    for (const client of clients) client.close();
    await service.close();
  }
  return { ...service, origin, connect, host, player, stationCode, joinStation, attemptStation, fixtureRoute, operate, step, time: now, admin, close };
}
export const scanCode = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get("scan")!;

