import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ANSWER_COOLDOWN_MS, SCREEN_RECONNECT_MS } from "../packages/shared/rules";
import type { RoomView } from "../packages/shared/protocol";
import { harness, ok, send } from "./socket-helper";

test("restart preserves both boards, controller IDs, input sequences and timer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "campus-persistence-"));
  const dbPath = join(directory, "game.sqlite");
  let service = await harness(dbPath);
  try {
    await service.host("HOST-10");
    const a = await service.player("跨啟動甲");
    const b = await service.player("跨啟動乙");
    const lobby = await service.match([a,b]);
    const { id, deadline } = await service.begin([a,b], lobby.stationId);
    await service.operate(a.socket, a.id);
    await service.operate(b.socket, b.id);
    const aBefore = service.campus.playerView(a.id).room!;
    const saved = service.campus.hostView("HOST-10").room!.match!.panels;
    const at = service.time();
    await service.close();

    service = await harness(dbPath, at + 1100);
    await service.host("HOST-10");
    const first = await service.connect();
    const second = await service.connect();
    const restored = await ok(first, "player:reconnect", { token: a.token });
    await ok(second, "player:reconnect", { token: b.token });
    assert.equal(restored.room?.id, id);
    assert.equal(restored.room?.seq, aBefore.seq);
    assert.equal(restored.room?.deadline, deadline! + 1100);
    assert.equal(restored.room?.scene, null);
    assert.deepEqual(restored.room?.match?.remote, { ...aBefore.match?.remote, answerAvailableAt: at + 1100 + ANSWER_COOLDOWN_MS });
    assert.deepEqual(service.campus.hostView("HOST-10").room?.match?.panels, saved);
    const duplicate = await ok(first, "game:input", { sessionId: id, seq: aBefore.seq,
      action: { kind: "choice", questionId: aBefore.match!.remote!.questionId!, index: 0 }
    });
    assert.equal(duplicate.seq, aBefore.seq);
    const early = await send(first, "game:input", { sessionId: id, seq: aBefore.seq + 1,
      action: { kind: "choice", questionId: aBefore.match!.remote!.questionId!, index: 0 } });
    assert.ok(!early.ok && early.code === "answer-cooldown");
    assert.deepEqual(service.campus.hostView("HOST-10").room?.match?.panels, saved);
    service.step(restored.room!.deadline! - service.time());
    assert.equal(service.store.resultsForSession(id).length, 2);
    assert.equal((await send(first, "game:input", { sessionId: id, seq: 20, action: { kind: "move", direction: "up" } })).ok, false);
    const endedAt = service.time();
    await service.close();

    service = await harness(dbPath, endedAt + 12_000);
    const phone = await service.connect();
    const current = await ok(phone, "player:reconnect", { token: a.token });
    assert.equal(current.player.id, a.id);
    assert.equal(current.route.completed, 1);
    assert.equal(current.lastResult?.sessionId, id);
    assert.equal(service.campus.adminView().sessions[0].id, id);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a lost screen freezes the running clock and arcade state, then resumes without replaying the outage", async () => {
  const service = await harness();
  try {
    const initialHost = await service.host("HOST-09");
    const a = await service.player("主機掉線甲");
    const b = await service.player("主機掉線乙");
    const lobby = await service.match([a,b]);
    const began = await service.begin([a,b], lobby.stationId);
    for (const player of [a,b]) await service.control(player, { kind: "action", action: "duck" });
    const engine = () => service.store.get<{ engine_state: string }>("SELECT engine_state FROM game_sessions WHERE session_id=?", began.id)!.engine_state;
    const saved = engine();
    const paused = new Promise<RoomView>(resolve => {
      const read = (room: RoomView) => {
        if (room.pausedAt == null) return;
        a.socket.off("game:state", read);
        resolve(room);
      };
      a.socket.on("game:state", read);
    });
    initialHost.disconnect();
    assert.equal((await paused).pausedAt, service.time());
    service.step(15_000);
    const early = await send(a.socket, "game:input", { sessionId: began.id, seq: 2, action: { kind: "action", action: "jump" } });
    assert.ok(!early.ok && early.code === "host-offline");
    assert.equal(engine(), saved);
    await service.host("HOST-09");
    const resumed = service.campus.playerView(a.id).room!;
    assert.equal(resumed.pausedAt, undefined);
    assert.equal(resumed.deadline, began.deadline! + 15_000);
    assert.equal(resumed.deadline! - resumed.startedAt!, 60_000);
    assert.equal(engine(), saved);
    service.step(resumed.deadline! - service.time());
    assert.ok(service.store.resultsForSession(began.id).every(result => result.duration === 60_000));
  } finally { await service.close(); }
});

test("an offline screen that misses the reconnect window cancels the round and restores the queues", async () => {
  const service = await harness();
  try {
    const host = await service.host("HOST-09");
    const a = await service.player("候補闖關");
    const b = await service.player("候補陪打");
    await ok(a.socket, "match:find", null);
    await ok(b.socket, "match:assist", null);
    service.step(10_000);
    const lobby = service.campus.playerView(a.id).room!;
    assert.ok(lobby);
    await service.begin([a,b], lobby.stationId);
    host.disconnect();
    for (let tries = 0; tries < 50 && service.campus.adminView().connections.hosts; tries++) await delay(5);
    assert.equal(service.campus.adminView().connections.hosts, 0);
    service.step(SCREEN_RECONNECT_MS);
    const row = service.campus.adminView().sessions.find(item => item.id === lobby.id);
    assert.deepEqual([row?.status, row?.reason], ["cancelled", "host-offline"]);
    assert.deepEqual(service.store.resultsForSession(lobby.id), []);
    assert.equal(service.campus.playerView(a.id).route.searching, true);
    assert.equal(service.campus.playerView(b.id).route.assisting, true);
  } finally { await service.close(); }
});

test("a one-sided attempt expires without points and retains progress eligibility", async () => {
  const service = await harness();
  try {
    await service.host("HOST-01");
    const a = await service.player("有操作");
    const b = await service.player("沒操作");
    const lobby = await service.match([a,b]);
    await service.begin([a,b], lobby.stationId);
    await service.operate(a.socket, a.id);
    service.step(60_000);
    assert.equal(service.store.resultsForSession(lobby.id).length, 0);
    assert.equal(service.campus.playerView(a.id).route.completed, 0);
    assert.equal(service.campus.playerView(a.id).route.searching, true);
    assert.equal(service.campus.playerView(b.id).route.searching, false);
    assert.equal(service.campus.adminView().sessions[0].reason, "no-play");
  } finally { await service.close(); }
});
