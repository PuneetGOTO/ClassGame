import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DOUBLE_START_MS, DOUBLE_END_MS } from "../packages/shared/rules";
import type { DoubleChallenge, Quiz } from "../packages/shared/protocol";
import { harness, ok, send } from "./socket-helper";
import { arithmetic, move } from "./solve";

test("the draw is hidden during countdown, survives restart, and signs a timed-out score", async () => {
  const dir = await mkdtemp(join(tmpdir(), "campus-double-"));
  const dbPath = join(dir, "double.sqlite");
  let service = await harness(dbPath);
  try {
    await service.host("HOST-01");
    assert.equal((await service.admin("/rules", { doubleChance: 100 }, "PUT")).status, 200);
    const player = await service.player("抽中但失敗");
    service.fixtureRoute(player.id, "game-01");
    const { room } = await service.joinStation(player.socket, "STATION-01");
    const sessionId = room!.id;
    const ready = await ok(player.socket, "game:ready", { sessionId, ready: true });
    assert.equal(ready.room?.doubleChallenge, null);
    const started = ready.room!.startedAt!;
    const deadline = ready.room!.deadline!;
    const scheduled = service.store.get<{ double_due_at: number }>(
      "SELECT double_due_at FROM game_sessions WHERE session_id=?", sessionId)!.double_due_at;
    assert.ok(scheduled >= started + DOUBLE_START_MS && scheduled <= started + DOUBLE_END_MS);
    service.step(scheduled - service.time() - 1);
    assert.equal(service.campus.playerView(player.id).room?.doubleChallenge, null);
    assert.equal(service.campus.hostView("HOST-01").room?.doubleChallenge, null);
    await service.operate(player.socket, player.id);
    const event = new Promise<DoubleChallenge>(resolve => player.socket.once("game:double-challenge", message => resolve(message.challenge)));
    service.step(1);
    const activated = await event;
    assert.equal(activated.playerId, player.id);
    assert.equal(activated.startedAt, scheduled);
    const at = service.time();
    await service.close();

    service = await harness(dbPath, at + 100);
    const phone = await service.connect();
    const restored = await ok(phone, "player:reconnect", { token: player.token });
    assert.deepEqual(restored.room?.doubleChallenge, activated);
    assert.equal(restored.room?.deadline, deadline);
    service.step(deadline - service.time());
    const result = service.store.resultsForSession(sessionId)[0];
    assert.deepEqual([result.outcome, result.rawPoints, result.baseAwarded, result.awarded, result.doublePoints], ["lose", 1, 1, -2, true]);
    assert.equal(service.store.player(player.id)?.total_score, -2);
    assert.equal(service.store.leaderboard().teams.find(team => team.id === "TEAM-01")?.score, -0.4);
    assert.equal((await send(phone, "game:input", { sessionId, seq: 99, action: move("up") })).ok, false);
    assert.equal(service.store.player(player.id)?.total_score, -2);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a later-stage draw doubles the weighted win and stays private from the other player", async () => {
  const service = await harness();
  try {
    const player = await service.player("第六關");
    const outsider = await service.player("旁觀者", "TEAM-01");
    let leaked = false;
    outsider.socket.on("game:double-challenge", () => { leaked = true; });
    await ok(outsider.socket, "campus:watch", null);
    const games = ["02", "03", "04", "05", "06", "18"];
    service.fixtureRoute(player.id, ...games.map(number => "game-" + number));
    for (const [index, number] of games.entries()) {
      await service.host("HOST-" + number);
      if (index === 5) assert.equal((await service.admin("/rules", { doubleChance: 100 }, "PUT")).status, 200);
      const { room } = await service.joinStation(player.socket, "STATION-" + number);
      const sessionId = room!.id;
      await ok(player.socket, "game:ready", { sessionId, ready: true });
      service.step(3000);
      if (index < 5) {
        await service.operate(player.socket, player.id);
        service.step(60_000);
        continue;
      }
      service.step(DOUBLE_END_MS);
      const view = () => service.campus.playerView(player.id).room!;
      assert.equal(view().doubleChallenge?.playerId, player.id);
      assert.deepEqual(view().course, { step: 6, tier: 2 });
      const target = view().progress!.target;
      for (let i = 0; i < target; i++) {
        service.step(85);
        await ok(player.socket, "game:input", { sessionId, seq: view().seq + 1, action: arithmetic((view().scene as Quiz).prompt!) });
      }
      const result = service.store.resultsForSession(sessionId)[0];
      assert.deepEqual([result.step, result.outcome, result.baseAwarded, result.awarded, result.doublePoints], [6, "win", 4, 8, true]);
      assert.equal(leaked, false);
      assert.equal(service.store.player(player.id)?.total_score, 13);
      assert.equal(service.store.player(outsider.id)?.total_score, 0);
    }
  } finally { await service.close(); }
});
