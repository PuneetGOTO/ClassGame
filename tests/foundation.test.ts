import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ok, send, harness } from "./socket-helper";

test("authenticated station, queue, countdown and authoritative timeout", async () => {
  const service = await harness();
  try {
    const a = await service.player("甲");
    const b = await service.player("乙");
    service.fixtureRoute(a.id, "game-01");
    service.fixtureRoute(b.id, "game-01");
    assert.equal((await ok(a.socket, "campus:watch", null)).stations.length, 20);
    assert.equal((await send(a.socket, "station:join", { stationId: "STATION-01" })).ok, false);
    const unauthorized = await fetch(service.origin + "/api/admin/state");
    assert.equal(unauthorized.status, 401);
    const host = await service.host("HOST-01");
    const waiting = await service.joinStation(a.socket,"STATION-01");
    const queued = await service.joinStation(b.socket,"STATION-01");
    const sessionId = waiting.room!.id;
    assert.equal(queued.queue!.position, 1);
    assert.equal((await send(b.socket, "game:ready", { sessionId, ready: true })).ok, false);
    const countdown = await ok(a.socket, "game:ready", { sessionId, ready: true });
    assert.equal(countdown.room!.status, "countdown");
    assert.equal(countdown.room!.scene, null);
    assert.equal(countdown.room!.startedAt! - service.time(), 3000);
    assert.equal(countdown.room!.deadline! - countdown.room!.startedAt!, 60_000);
    assert.equal((await send(host, "game:input", { sessionId, seq: 1, action: { kind: "move", direction: "up" } })).ok, false);
    service.step(3000);
    assert.equal(service.campus.playerView(a.id).room!.status, "running");
    assert.equal((await send(a.socket, "game:input", { sessionId: randomUUID(), seq: 1, action: { kind: "move", direction: "up" } })).ok, false);
    await service.operate(a.socket, a.id);
    const leave = await send(a.socket, "station:leave", null);
    assert.ok(!leave.ok && leave.code === "in-progress");
    service.step(59_999);
    assert.equal(service.campus.playerView(a.id).player.totalScore, 0);
    const timeout = new Promise(resolve => a.socket.once("game:timeout", resolve));
    service.step(1);
    await timeout;
    assert.equal(service.campus.playerView(a.id).player.totalScore, 1);
    assert.equal(service.campus.playerView(a.id).lastResult!.duration, 60_000);
    assert.equal(service.campus.playerView(a.id).route.completed, 1);
    assert.equal(service.campus.playerView(b.id).player.totalScore, 0);
    service.step(5000);
    assert.equal(service.campus.playerView(b.id).room!.status, "lobby");
    assert.equal((await service.admin("/stations/STATION-01/action", { action: "reset" })).status, 200);
    assert.equal(service.campus.playerView(b.id).room, null);
    assert.equal((await service.attemptStation(a.socket,"STATION-01")).ok, false);
  } finally { await service.close(); }
});

