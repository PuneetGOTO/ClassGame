import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import type { Ack, Action, ClientEvents, ServerEvents } from "../packages/shared/protocol";
import { hostKey } from "../apps/server/src/config";
import { HOST_SCREEN_VERSION } from "../packages/shared/rules";
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
    await ok(client, "host:register", {
      hostId: id, key: hostKey(credentials.hostSecret, id), entryOrigin: origin, screenVersion: HOST_SCREEN_VERSION
    });
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
  function panel(id: string) {
    const room = service.campus.playerView(id).room!;
    const side = room.members.find(member => member.id === id)!.side;
    return service.campus.hostView(room.hostId).room!.match!.panels!.find(item => item.side === side)!;
  }
  async function control(player: { socket: Client; id: string }, action: Action) {
    const room = service.campus.playerView(player.id).room!;
    return ok(player.socket, "game:input", { sessionId: room.id, seq: room.seq + 1, action });
  }
  async function operate(client: Client, id: string) {
    const room = service.campus.playerView(id).room!;
    const visible = panel(id);
    const scene = visible.scene!;
    assert.equal(room.status, "running");
    let inputs: Action[] = (["up", "right", "down", "left"] as const).map(direction => ({ kind: "move", direction }));
    if (visible.cursor !== null) {
      if (scene.kind === "tubes" && !scene.tubes[visible.cursor].length) {
        for (let at = visible.cursor; !scene.tubes[at].length; at = (at + 1) % scene.tubes.length) {
          await control({ socket: client, id }, { kind: "cursor", direction: "right" });
        }
      }
      inputs = [{ kind: "action", action: "interact" }];
    } else if (scene.kind === "quiz") {
      const question = scene.prompt!;
      inputs = [question.options ? { kind: "choice", questionId: question.id, index: 0 }
        : { kind: "answer", questionId: question.id, value: "1" }];
    } else if (scene.kind === "arcade" && scene.theme !== "road") {
      inputs = [{ kind: "action", action: scene.theme === "space" ? "shoot" : "jump" }];
    }
    for (const action of inputs) {
      await control({ socket: client, id }, action);
      if (service.store.get<{ played: number }>("SELECT played FROM session_members WHERE session_id=? AND player_id=?", room.id, id)!.played) return;
    }
    assert.fail("No valid input registered for " + room.gameId);
  }
  async function match(players: { socket: Client; id: string }[]) {
    await Promise.all(players.map(player => ok(player.socket, "match:find", null)));
    step(10_000);
    const rooms = players.map(player => service.campus.playerView(player.id).room);
    assert.ok(rooms.every(room => room && room.id === rooms[0]!.id));
    return rooms[0]!;
  }
  async function begin(players: { socket: Client; id: string }[], stationId: string) {
    const joined = await Promise.all(players.map(player => joinStation(player.socket, stationId)));
    const sessionId = joined[0].room!.id;
    const ready = await Promise.all(players.map(player => ok(player.socket, "game:ready", { sessionId, ready: true })));
    assert.ok(ready.some(item => item.room?.status === "countdown"));
    step(3000);
    return service.campus.playerView(players[0].id).room!;
  }
  function step(delta = 0) {
    time += delta;
    service.campus.step();
    service.practice.step();
  }
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
  return { ...service, origin, connect, host, player, stationCode, joinStation, attemptStation, panel, control, operate, match, begin, step, time: now, admin, close };
}
export const scanCode = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get("scan")!;

