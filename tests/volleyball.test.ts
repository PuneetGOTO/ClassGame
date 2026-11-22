import assert from "node:assert/strict";
import { test } from "node:test";
import { Arena } from "../apps/server/src/arena";
import { hostKey } from "../apps/server/src/config";
import { selectMatch, type Candidate } from "../apps/server/src/matchmaking";
import { plugins } from "../local-games/registry";
import { GAME_MS, NUMBER_HUNT_ID, VOLLEYBALL_ID } from "../packages/shared/catalog";
import type { Result, RoomView, VolleyballScene } from "../packages/shared/protocol";
import { MATCH_WAIT_MS } from "../packages/shared/rules";
import { credentials, harness, send } from "./socket-helper";

test("three waiting players can form a volleyball pair without creating an unbalanced court", () => {
  const waiting: Candidate[] = ["one", "two", "three"].map(id => ({
    id, step: 1, queuedAt: 0, games: new Set(), lastFloor: null
  }));
  const rooms = [{ id: "STATION-19", gameId: VOLLEYBALL_ID, floor: 4 as const }];
  assert.equal(selectMatch(waiting, rooms, MATCH_WAIT_MS - 1), undefined);
  assert.deepEqual(selectMatch(waiting, rooms, MATCH_WAIT_MS)?.players.map(player => player.id), ["one", "two"]);
});

test("slime volleyball supports hold/release/jump, net bounds, serialization, and strict 60s win rule", () => {
  const seats = [{ id: "p1", side: 0 }, { id: "p2", side: 1 }];
  const arena = new Arena(plugins.get(VOLLEYBALL_ID)!, VOLLEYBALL_ID, 42, 1, seats);
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
  const restored = new Arena(plugins.get(VOLLEYBALL_ID)!, VOLLEYBALL_ID, 42, 1, seats, arena.serialize());
  assert.deepEqual(restored.panel(0), arena.panel(0));
  assert.deepEqual(restored.panel(1), arena.panel(1));

  // 通过让左侧玩家躲到最左边界、右侧持续稳住，验证即使超过原版 11 分也不会在 60 秒内提前结束
  const match = new Arena(plugins.get(VOLLEYBALL_ID)!, VOLLEYBALL_ID, 105, 1, seats);
  match.start();
  match.input(0, "p1", { kind: "action", action: "hold-left" }, 20, 20);
  match.input(1, "p2", { kind: "action", action: "hold-right" }, 20, 20);
  for (let t = 80; t < GAME_MS; t += 80) {
    match.tick(t, t, new Set([0, 1]));
    if (t === 5040) {
      match.clearHeldControls();
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
    const oldScreen = await service.connect();
    const upgradeRequired = await send(oldScreen, "host:register", {
      hostId: "HOST-19", key: hostKey(credentials.hostSecret, "HOST-19"), screenVersion: 2
    });
    assert.ok(!upgradeRequired.ok && upgradeRequired.code === "host-refresh");
    oldScreen.disconnect();
    await service.host("HOST-19");
    assert.equal(service.campus.snapshot().games.length, 20);
    assert.ok(!service.campus.snapshot().games.some(game => game.id === NUMBER_HUNT_ID));
    assert.equal(service.campus.hostView("HOST-19").station.gameId, VOLLEYBALL_ID);
    const players = await Promise.all(Array.from({ length: 4 }, (_, i) => service.player("排球手 " + (i + 1))));

    const timeouts = players.map(player => new Promise<RoomView>(resolve => {
      player.socket.once("game:timeout", resolve);
    }));
    const scoreResults = players.map(player => new Promise<Result>(resolve => {
      player.socket.once("score:result", resolve);
    }));

    const lobby = await service.match(players);
    assert.equal(lobby.gameId, VOLLEYBALL_ID);
    const room = await service.begin(players, lobby.stationId);
    assert.equal(room.match?.mode, "doubles");

    const blue = players.filter(p => room.members.find(m => m.id === p.id)?.side === 0);
    const orange = players.filter(p => room.members.find(m => m.id === p.id)?.side === 1);
    assert.equal(blue.length, 2);
    assert.equal(orange.length, 2);

    // 4 名玩家各自发送互不干扰的动作
    const blueByPosition = blue.sort((a, b) => room.members.find(m => m.id === a.id)!.position - room.members.find(m => m.id === b.id)!.position);
    await service.control(blueByPosition[1], { kind: "action", action: "hold-right" });
    await service.control(blueByPosition[0], { kind: "action", action: "hold-left" });
    await service.control(orange[0], { kind: "action", action: "hold-right" });
    await service.control(orange[1], { kind: "action", action: "jump" });

    service.step(120);
    const panel = service.campus.hostView("HOST-19").room!.match!.panels![0];
    assert.equal(panel.scene?.kind, "volleyball");
    const volleyScene = panel.scene as VolleyballScene;
    assert.equal(volleyScene.players.length, 4);
    assert.deepEqual(
      volleyScene.players.filter(p => p.side === 0).map(p => p.moveDir),
      [-1, 1]
    );
    assert.ok(volleyScene.players.some(p => p.side === 1 && p.moveDir === 1));
    assert.ok(volleyScene.players.some(p => p.side === 1 && p.y < volleyScene.height));

    // 推进至 59.72 秒仍处于运行中，满 60 秒后立刻结算并吐出输赢结果
    for (let elapsed = 0; elapsed < GAME_MS - 400; elapsed += 200) {
      service.step(200);
    }
    assert.equal(service.campus.hostView("HOST-19").room?.status, "running");
    service.step(400);

    const endedHost = service.campus.hostView("HOST-19").room!;
    assert.equal(endedHost.status, "finished");
    assert.equal(endedHost.reason, "timeout");

    const receivedTimeouts = await Promise.all(timeouts);
    const receivedResults = await Promise.all(scoreResults);
    assert.ok(receivedTimeouts.every(view => view.status === "finished" && view.reason === "timeout"));
    assert.equal(receivedResults.length, 4);
    assert.ok(receivedResults.every(res => res.gameId === VOLLEYBALL_ID && res.participated));
  } finally {
    await service.close();
  }
});
