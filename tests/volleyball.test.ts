import assert from "node:assert/strict";
import { test } from "node:test";
import { Arena } from "../apps/server/src/arena";
import { plugins } from "../local-games/registry";
import { GAME_MS } from "../packages/shared/catalog";
import type { Result, RoomView, VolleyballScene } from "../packages/shared/protocol";
import { harness } from "./socket-helper";

test("slime volleyball supports hold/release/jump, net bounds, serialization, and strict 60s win rule", () => {
  const arena = new Arena(plugins.get("game-21")!, "game-21", 42, 1, [0, 1]);
  arena.start();

  // 按住右移持续 400ms 后不能越过球网，松开后停止（避开约 560ms 后的首次落地冻结）
  arena.input(0, "p1", { kind: "action", action: "hold-right" }, 10, 10);
  for (let t = 50; t <= 400; t += 50) arena.tick(t, t, new Set([0, 1]));
  const rightBound = arena.panel(0).scene as VolleyballScene;
  const p1AfterRight = rightBound.players[0];
  assert.ok(p1AfterRight.x <= rightBound.width / 2 - rightBound.netWidth / 2 - p1AfterRight.radius);
  assert.equal(p1AfterRight.moveDir, 1);

  arena.input(0, "p1", { kind: "action", action: "release" }, 410, 410);
  arena.tick(430, 430, new Set([0, 1]));
  const stopped = (arena.panel(0).scene as VolleyballScene).players[0];
  assert.equal(stopped.moveDir, 0);
  assert.equal(stopped.vx, 0);

  // 跳跃离地验证
  arena.input(0, "p1", { kind: "action", action: "jump" }, 440, 440);
  arena.tick(500, 500, new Set([0, 1]));
  const jumping = (arena.panel(0).scene as VolleyballScene).players[0];
  assert.ok(jumping.y < rightBound.height);

  // 序列化与恢复严格一致
  const restored = new Arena(plugins.get("game-21")!, "game-21", 42, 1, [0, 1], arena.serialize());
  assert.deepEqual(restored.panel(0), arena.panel(0));
  assert.deepEqual(restored.panel(1), arena.panel(1));

  // 通过让左侧玩家躲到最左边界、右侧持续稳住，验证即使超过原版 11 分也不会在 60 秒内提前结束
  const match = new Arena(plugins.get("game-21")!, "game-21", 105, 1, [0, 1]);
  match.start();
  match.input(0, "left", { kind: "action", action: "hold-left" }, 20, 20);
  match.input(1, "right", { kind: "action", action: "hold-right" }, 20, 20);
  for (let t = 80; t < GAME_MS; t += 80) {
    match.tick(t, t, new Set([0, 1]));
    if (t === 5000) {
      match.input(0, "left", { kind: "action", action: "release" }, t, t);
      match.input(1, "right", { kind: "action", action: "release" }, t, t);
    }
    assert.equal(match.result(new Set([0, 1]), false), undefined);
  }
  match.tick(GAME_MS, GAME_MS, new Set([0, 1]));
  const sceneAtEnd = match.panel(0).scene as VolleyballScene;
  const totalPoints = sceneAtEnd.scores[0] + sceneAtEnd.scores[1];
  assert.ok(totalPoints > 0, "60 秒内应产生至少 1 次落地得分");

  const final = match.result(new Set([0, 1]), true);
  assert.ok(final);
  assert.equal(final.reason, "timeout");
  const expectedWinner = sceneAtEnd.scores[0] === sceneAtEnd.scores[1]
    ? null
    : sceneAtEnd.scores[0] > sceneAtEnd.scores[1] ? 0 : 1;
  assert.equal(final.winner, expectedWinner);
});

test("2v2 slime volleyball assigns 4 distinct slimes and emits timeout + score:result at 60s", async () => {
  const service = await harness();
  try {
    service.store.run("UPDATE hosts SET assigned_game_id='game-21' WHERE host_id='HOST-01'");
    await service.host("HOST-01");
    const players = await Promise.all(Array.from({ length: 4 }, (_, i) => service.player("排球手 " + (i + 1))));

    const timeouts = players.map(player => new Promise<RoomView>(resolve => {
      player.socket.once("game:timeout", resolve);
    }));
    const scoreResults = players.map(player => new Promise<Result>(resolve => {
      player.socket.once("score:result", resolve);
    }));

    const lobby = await service.match(players);
    assert.equal(lobby.gameId, "game-21");
    const room = await service.begin(players, lobby.stationId);
    assert.equal(room.match?.mode, "doubles");

    const blue = players.filter(p => room.members.find(m => m.id === p.id)?.side === 0);
    const orange = players.filter(p => room.members.find(m => m.id === p.id)?.side === 1);
    assert.equal(blue.length, 2);
    assert.equal(orange.length, 2);

    // 4 名玩家各自发送互不干扰的动作
    await service.control(blue[0], { kind: "action", action: "hold-left" });
    await service.control(blue[1], { kind: "action", action: "hold-right" });
    await service.control(orange[0], { kind: "action", action: "hold-right" });
    await service.control(orange[1], { kind: "action", action: "jump" });

    service.step(120);
    const panel = service.campus.hostView("HOST-01").room!.match!.panels![0];
    assert.equal(panel.scene?.kind, "volleyball");
    const volleyScene = panel.scene as VolleyballScene;
    assert.equal(volleyScene.players.length, 4);
    assert.deepEqual(
      volleyScene.players.filter(p => p.side === 0).map(p => p.moveDir).sort(),
      [-1, 1]
    );
    assert.ok(volleyScene.players.some(p => p.side === 1 && p.moveDir === 1));
    assert.ok(volleyScene.players.some(p => p.side === 1 && p.y < volleyScene.height));

    // 推进至 59.72 秒仍处于运行中，满 60 秒后立刻结算并吐出输赢结果
    for (let elapsed = 0; elapsed < GAME_MS - 400; elapsed += 200) {
      service.step(200);
    }
    assert.equal(service.campus.hostView("HOST-01").room?.status, "running");
    service.step(400);

    const endedHost = service.campus.hostView("HOST-01").room!;
    assert.equal(endedHost.status, "finished");
    assert.equal(endedHost.reason, "timeout");

    const receivedTimeouts = await Promise.all(timeouts);
    const receivedResults = await Promise.all(scoreResults);
    assert.ok(receivedTimeouts.every(view => view.status === "finished" && view.reason === "timeout"));
    assert.equal(receivedResults.length, 4);
    assert.ok(receivedResults.every(res => res.gameId === "game-21" && res.participated));
  } finally {
    await service.close();
  }
});
