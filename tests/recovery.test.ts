import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { harness, ok, send } from "./socket-helper";
import { arithmetic } from "./solve";
import type { Quiz } from "../packages/shared/protocol";

test("SQLite restart preserves the private board, input sequence, deadline, progress and route", async () => {
  const directory = await mkdtemp(join(tmpdir(), "campus-persistence-"));
  const dbPath = join(directory, "game.sqlite");
  let service = await harness(dbPath);
  try {
    await service.host("HOST-10");
    const player = await service.player("跨啟動持久化");
    service.fixtureRoute(player.id, "game-10");
    const lobby = await service.joinStation(player.socket, "STATION-10");
    const sessionId = lobby.room!.id;
    await ok(player.socket, "game:ready", { sessionId, ready: true });
    service.step(3000);
    function room() { return service.campus.playerView(player.id).room!; }
    await ok(player.socket, "game:input", { sessionId, seq: 1, action: arithmetic((room().scene as Quiz).prompt!) });
    const snapshot = room();
    const order = service.store.all("SELECT * FROM player_routes ORDER BY step");
    const at = service.time();
    await service.close();

    service = await harness(dbPath, at + 1100);
    await service.host("HOST-10");
    assert.equal(service.campus.hostView("HOST-10").room?.id, sessionId);
    assert.equal(service.campus.hostView("HOST-10").room?.scene, null);
    const phone = await service.connect();
    const restored = await ok(phone, "player:reconnect", { token: player.token });
    assert.equal(restored.room?.seq, 1);
    assert.equal(restored.room?.deadline, snapshot.deadline);
    assert.deepEqual(restored.room?.scene, snapshot.scene);
    assert.deepEqual(restored.route, lobby.route);
    assert.deepEqual(service.store.all("SELECT * FROM player_routes ORDER BY step"), order);
    while (room()) {
      service.step(90);
      await ok(phone, "game:input", { sessionId, seq: room().seq + 1, action: arithmetic((room().scene as Quiz).prompt!) });
    }
    assert.equal(service.store.player(player.id)?.total_score, 2);
    const endedAt = service.time();
    await service.close();

    service = await harness(dbPath, endedAt + 12_000);
    const reconnected = await service.connect();
    const current = await ok(reconnected, "player:reconnect", { token: player.token });
    assert.equal(current.player.id, player.id);
    assert.equal(current.player.totalScore, 2);
    assert.equal(current.route.completed, 1);
    assert.equal(current.route.next?.step, 2);
    assert.equal(current.lastResult?.sessionId, sessionId);
    assert.equal(service.campus.adminView().sessions[0].id, sessionId);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an idle attempt cannot skip a mission and reopening preserves the same mission and double draw", async () => {
  const service = await harness();
  try {
    const player = await service.player("未操作");
    const id = player.id;
    const next = player.state.route.next!;
    const host = service.store.stationRows().find(station => station.id === next.stationId)!.hostId;
    await service.host(host);
    assert.equal((await service.admin("/rules", { doubleChance: 100 }, "PUT")).status, 200);
    const lobby = await service.joinStation(player.socket, next.stationId);
    const ready = await ok(player.socket, "game:ready", { sessionId: lobby.room!.id, ready: true });
    assert.equal(ready.room?.scene, null);
    service.step(3000);
    const first = service.campus.playerView(id).room!;
    await ok(player.socket, "game:input", {
      sessionId: first.id, seq: 1, action: { kind: "answer", questionId: 9999, value: "0" }
    });
    const ended = new Promise(resolve => player.socket.once("game:finish", resolve));
    service.step(60_000);
    await ended;
    assert.equal(service.store.resultsForSession(first.id).length, 0);
    const afterIdle = service.campus.playerView(id);
    assert.equal(afterIdle.route.completed, 0);
    assert.deepEqual(afterIdle.route.next, next);
    assert.equal(afterIdle.player.totalScore, 0);
    assert.equal(service.campus.adminView().sessions[0].reason, "no-play");
    assert.equal((await service.admin("/stations/" + next.stationId + "/action", { action: "retry" })).status, 400);

    assert.equal((await service.admin("/rules", { doubleChance: 0 }, "PUT")).status, 200);
    const retry = await service.joinStation(player.socket, next.stationId);
    await ok(player.socket, "game:ready", { sessionId: retry.room!.id, ready: true });
    service.step(3000);
    const restarted = service.campus.playerView(id).room!;
    assert.deepEqual(restarted.scene, first.scene);
    const offset = (sessionId: string) => service.store.get<{ draw: number }>(
      "SELECT double_due_at-started_at AS draw FROM game_sessions WHERE session_id=?", sessionId)!.draw;
    assert.ok(offset(first.id) >= 6000);
    assert.equal(offset(first.id), offset(restarted.id));
    const wrong = await send(player.socket, "game:input", {
      sessionId: first.id, seq: 2, action: { kind: "move", direction: "up" }
    });
    assert.ok(!wrong.ok && wrong.code === "wrong-session");
  } finally { await service.close(); }
});
