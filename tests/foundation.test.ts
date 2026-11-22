import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MATCH_ARRIVAL_MS } from "../packages/shared/rules";
import { ok, send, harness } from "./socket-helper";

test("the station requires two scanned and ready players and enforces a 60 second deadline", async () => {
  const service = await harness();
  try {
    const a = await service.player("甲");
    const b = await service.player("乙");
    assert.equal((await ok(a.socket, "campus:watch", null)).stations.length, 20);
    assert.equal((await fetch(service.origin + "/api/admin/state")).status, 401);
    const host = await service.host("HOST-10");
    const stationId = "STATION-10";
    const bypass = await send(a.socket, "station:join", { stationId });
    assert.ok(!bypass.ok && bypass.code === "no-match");
    await ok(a.socket, "match:find", null);
    service.step(12_000);
    assert.equal(service.campus.playerView(a.id).room, null);
    const lobby = await service.match([a,b]);
    const sessionId = lobby.id;
    const unscanned = await send(b.socket, "game:ready", { sessionId, ready: true });
    assert.ok(!unscanned.ok && unscanned.code === "scan-required");

    await service.joinStation(a.socket, stationId);
    assert.equal((await ok(a.socket, "game:ready", { sessionId, ready: true })).room!.status, "lobby");
    assert.equal((await service.admin("/stations/" + stationId + "/action", { action: "start" })).status, 409);
    await service.joinStation(b.socket, stationId);
    const countdown = await ok(b.socket, "game:ready", { sessionId, ready: true });
    assert.equal(countdown.room!.status, "countdown");
    assert.equal(countdown.room!.startedAt! - service.time(), 3000);
    assert.equal(countdown.room!.deadline! - countdown.room!.startedAt!, 60_000);
    assert.equal((await send(host, "game:input", { sessionId, seq: 1, action: { kind: "move", direction: "up" } })).ok, false);
    service.step(3000);
    const wrong = await send(a.socket, "game:input", { sessionId: randomUUID(), seq: 1, action: { kind: "move", direction: "up" } });
    assert.ok(!wrong.ok && wrong.code === "wrong-session");
    const earlyLeave = await send(a.socket, "station:leave", null);
    assert.ok(!earlyLeave.ok && earlyLeave.code === "in-progress");
    await service.operate(a.socket, a.id);
    await service.operate(b.socket, b.id);
    service.step(59_999);
    assert.equal(service.campus.playerView(a.id).player.totalScore, 0);
    service.step(1);
    assert.equal(service.campus.playerView(a.id).route.completed, 1);
    assert.equal(service.campus.playerView(b.id).lastResult!.duration, 60_000);
    assert.equal(service.store.resultsForSession(sessionId).length, 2);
  } finally { await service.close(); }
});

test("a player without an opponent is requeued and no result is fabricated", async () => {
  const service = await harness();
  try {
    const a = await service.player("已到場");
    const b = await service.player("未到場");
    await service.host("HOST-01");
    const lobby = await service.match([a,b]);
    await service.joinStation(a.socket, lobby.stationId);
    await ok(a.socket, "game:ready", { sessionId: lobby.id, ready: true });
    service.step(MATCH_ARRIVAL_MS);
    assert.equal(service.campus.playerView(a.id).route.searching, true);
    assert.equal(service.campus.playerView(b.id).route.searching, false);
    assert.equal(service.campus.playerView(b.id).room, null);
    assert.equal(service.store.resultsForSession(lobby.id).length, 0);
  } finally { await service.close(); }
});
