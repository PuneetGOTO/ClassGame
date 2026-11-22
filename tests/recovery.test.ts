import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
    assert.equal(restored.room?.deadline, deadline);
    assert.equal(restored.room?.scene, null);
    assert.deepEqual(restored.room?.match?.remote, aBefore.match?.remote);
    assert.deepEqual(service.campus.hostView("HOST-10").room?.match?.panels, saved);
    const duplicate = await ok(first, "game:input", { sessionId: id, seq: aBefore.seq,
      action: { kind: "choice", questionId: aBefore.match!.remote!.questionId!, index: 0 }
    });
    assert.equal(duplicate.seq, aBefore.seq);
    assert.deepEqual(service.campus.hostView("HOST-10").room?.match?.panels, saved);
    service.step(deadline! - service.time());
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
