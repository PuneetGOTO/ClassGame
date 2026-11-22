import assert from "node:assert/strict";
import { test } from "node:test";
import { Arena } from "../apps/server/src/arena";
import { plugins } from "../local-games/registry";
import { AIR_HOCKEY_ID, GAME_MS } from "../packages/shared/catalog";
import type { AirHockeyScene, Result, RoomView } from "../packages/shared/protocol";
import { harness } from "./socket-helper";

test("air hockey supports low-sensitivity joystick, boundary clamping, clearControls, and 40s overdrive", () => {
  const seats = [{ id: "p1", side: 0 }, { id: "p2", side: 1 }];
  const arena = new Arena(plugins.get(AIR_HOCKEY_ID)!, AIR_HOCKEY_ID, 42, 1, seats);
  arena.start();

  // 摇杆推向右上持续 1200ms 后应停在左半场中线和上边壁内侧
  arena.input(0, "p1", { kind: "stick", x: 1, y: -1 }, 10, 10);
  for (let t = 50; t <= 1200; t += 50) arena.tick(t, t, new Set([0, 1]));
  const midScene = arena.panel(0).scene as AirHockeyScene;
  const p1 = midScene.paddles[0];
  assert.ok(p1.x <= midScene.width / 2 - p1.radius);
  assert.ok(p1.y >= p1.radius);
  assert.equal(midScene.overdrive, false);

  // 松开摇杆或执行 clearHeldControls 后快速刹停
  arena.clearHeldControls("p1");
  for (let t = 1240; t <= 1600; t += 40) arena.tick(t, t, new Set([0, 1]));
  const stopped = (arena.panel(0).scene as AirHockeyScene).paddles[0];
  assert.equal(stopped.vx, 0);
  assert.equal(stopped.vy, 0);

  // 序列化与反序列化严格一致
  const restored = new Arena(plugins.get(AIR_HOCKEY_ID)!, AIR_HOCKEY_ID, 42, 1, seats, arena.serialize());
  assert.deepEqual(restored.panel(0), arena.panel(0));
  assert.deepEqual(restored.panel(1), arena.panel(1));

  // 第 40 秒起自动开启冰球加速（overdrive）
  for (let t = 1680; t <= 39_920; t += 80) arena.tick(t, t, new Set([0, 1]));
  assert.equal((arena.panel(0).scene as AirHockeyScene).overdrive, false);
  arena.tick(40_000, 40_000, new Set([0, 1]));
  assert.equal((arena.panel(0).scene as AirHockeyScene).overdrive, true);

  // 60 秒 0:0 同分按平局处理（无 5 秒加时）
  for (let t = 40_080; t <= GAME_MS; t += 80) arena.tick(t, t, new Set([0, 1]));
  const drawResult = arena.result(new Set([0, 1]), true);
  assert.deepEqual(drawResult, { winner: null, reason: "timeout" });
});

test("air hockey settles immediately when either side reaches 5 goals before 60s", () => {
  const seats = [{ id: "p1", side: 0 }, { id: "p2", side: 1 }];
  const arena = new Arena(plugins.get(AIR_HOCKEY_ID)!, AIR_HOCKEY_ID, 637, 1, seats);
  arena.start();

  // 选用零纵偏移种子 637：发球方沿中轴直线推射，防守方上移让开通道，验证先抢 5 分立即判胜
  let settled: ReturnType<Arena["result"]>;
  for (let t = 40; t < GAME_MS && !settled; t += 40) {
    const scene = arena.panel(0).scene as AirHockeyScene;
    if (!scene.frozen) {
      const attackerSide = scene.puck.x <= scene.width / 2 ? 0 : 1;
      const attackerId = attackerSide === 0 ? "p1" : "p2";
      const defenderId = attackerSide === 0 ? "p2" : "p1";
      arena.input(1 - attackerSide, defenderId, { kind: "stick", x: 0, y: -1 }, t, t);
      arena.input(attackerSide, attackerId, { kind: "stick", x: attackerSide === 0 ? 1 : -1, y: 0 }, t, t);
    }
    arena.tick(t, t, new Set([0, 1]));
    settled = arena.result(new Set([0, 1]), false);
  }

  assert.ok(settled, "应在 60 秒内有一方率先抢到 5 分提前获胜");
  assert.equal(settled.reason, "goal");
  assert.ok(settled.winner === 0 || settled.winner === 1);
  const endScene = arena.panel(0).scene as AirHockeyScene;
  assert.equal(endScene.scores[settled.winner], 5);
});

test("2v2 air hockey assigns 4 distinct paddles and emits timeout + score:result at 60s", async () => {
  const service = await harness();
  try {
    service.store.run("UPDATE hosts SET assigned_game_id=? WHERE host_id='HOST-01'", AIR_HOCKEY_ID);
    await service.host("HOST-01");
    const players = await Promise.all(Array.from({ length: 4 }, (_, i) => service.player("曲棍球手 " + (i + 1))));

    const timeouts = players.map(player => new Promise<RoomView>(resolve => {
      player.socket.once("game:timeout", resolve);
    }));
    const scoreResults = players.map(player => new Promise<Result>(resolve => {
      player.socket.once("score:result", resolve);
    }));

    const lobby = await service.match(players);
    assert.equal(lobby.gameId, AIR_HOCKEY_ID);
    const room = await service.begin(players, lobby.stationId);
    assert.equal(room.match?.mode, "doubles");

    const blue = players.filter(p => room.members.find(m => m.id === p.id)?.side === 0)
      .sort((a, b) => room.members.find(m => m.id === a.id)!.position - room.members.find(m => m.id === b.id)!.position);
    const orange = players.filter(p => room.members.find(m => m.id === p.id)?.side === 1)
      .sort((a, b) => room.members.find(m => m.id === a.id)!.position - room.members.find(m => m.id === b.id)!.position);

    assert.equal(blue.length, 2);
    assert.equal(orange.length, 2);

    // 4 名玩家各自推送摇杆向量，各自球拍独立移动
    await service.control(blue[0], { kind: "stick", x: 0.7, y: 0.4 });
    await service.control(blue[1], { kind: "stick", x: -0.6, y: -0.5 });
    await service.control(orange[0], { kind: "stick", x: -0.8, y: 0.3 });
    await service.control(orange[1], { kind: "stick", x: 0.5, y: -0.7 });

    service.step(160);
    const panel = service.campus.hostView("HOST-01").room!.match!.panels![0];
    assert.equal(panel.scene?.kind, "air-hockey");
    const hockeyScene = panel.scene as AirHockeyScene;
    assert.equal(hockeyScene.paddles.length, 4);
    assert.ok(hockeyScene.paddles.filter(p => p.side === 0).every(p => p.vx !== 0 && p.vy !== 0));
    assert.ok(hockeyScene.paddles.filter(p => p.side === 1).every(p => p.vx !== 0 && p.vy !== 0));

    // 推进至 59.6 秒仍在运行，满 60 秒后自动广播结算结果
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
    assert.ok(receivedResults.every(res => res.gameId === AIR_HOCKEY_ID && res.participated));
  } finally {
    await service.close();
  }
});
