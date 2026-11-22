import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Arena, matchMode } from "../apps/server/src/arena";
import { selectMatch, type Candidate } from "../apps/server/src/matchmaking";
import { plugins } from "../local-games/registry";
import { BOMBERMAN_ID, GAME_MS } from "../packages/shared/catalog";
import type { BombermanScene } from "../packages/shared/protocol";
import { MATCH_WAIT_MS } from "../packages/shared/rules";
import { harness, ok } from "./socket-helper";

const bomberFactory = plugins.get(BOMBERMAN_ID)!;

function candidate(id: string, queuedAt = 0): Candidate {
  return { id, step: 1, queuedAt, games: new Set(), lastFloor: 4 };
}

test("Neon Bomberman forbids 1v1 / 3-player matchmaking and only matches full 4-player rooms", () => {
  const rooms = [{ id: "STATION-06", gameId: BOMBERMAN_ID, floor: 3 as const }];
  const afterWait = MATCH_WAIT_MS + 500;

  assert.equal(selectMatch([candidate("p1"), candidate("p2")], rooms, afterWait), undefined);
  assert.equal(selectMatch([candidate("p1"), candidate("p2"), candidate("p3")], rooms, afterWait), undefined);

  const matched = selectMatch(
    [candidate("p1"), candidate("p2"), candidate("p3"), candidate("p4")],
    rooms,
    afterWait
  );
  assert.ok(matched);
  assert.equal(matched.stationId, "STATION-06");
  assert.equal(matched.players.length, 4);
  assert.equal(matchMode(4, 2), "doubles");
  assert.equal(matchMode(4, 4), "ffa4");
});

test("HOST-06 restores a free-for-all booking and persists a fourth-side victory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "campus-four-sides-"));
  const path = join(directory, "game.sqlite");
  let service = await harness(path);
  try {
    await service.host("HOST-06");
    const registered = await Promise.all(Array.from({ length: 4 }, (_, index) => service.player("炸彈人測試 " + (index + 1))));
    const lobby = await service.match(registered);
    assert.equal(lobby.gameId, BOMBERMAN_ID);
    service.store.run("UPDATE game_sessions SET seed=105 WHERE session_id=?", lobby.id);
    const now = service.time();
    await service.close();

    service = await harness(path, now + 1000);
    await service.host("HOST-06");
    assert.equal(service.campus.hostView("HOST-06").station.name, "307 室");
    const players = await Promise.all(registered.map(async player => {
      const socket = await service.connect();
      const state = await ok(socket, "player:reconnect", { token: player.token });
      assert.equal(state.room?.match?.mode, "ffa4");
      return { id: player.id, socket };
    }));
    const room = await service.begin(players, lobby.stationId);
    assert.equal(room.match?.mode, "ffa4");
    assert.deepEqual(service.store.all<{ side: number }>("SELECT side FROM session_members WHERE session_id=? ORDER BY side", room.id)
      .map(member => member.side), [0, 1, 2, 3]);
    const fourth = players.find(player => room.members.some(member => member.id === player.id && member.side === 3))!;
    await service.control(fourth, { kind: "move", direction: "up" });
    for (const player of players.filter(player => player !== fourth)) {
      await service.control(player, { kind: "action", action: "bomb" });
    }
    service.step(2050);
    assert.equal(service.campus.hostView("HOST-06").room?.match?.winner, 3);
    assert.equal(service.store.get<{ winner_side: number }>("SELECT winner_side FROM game_sessions WHERE session_id=?", room.id)?.winner_side, 3);
    const results = service.store.resultsForSession(room.id);
    assert.equal(results.length, 4);
    assert.equal(results.find(result => result.playerId === fourth.id)?.outcome, "win");
    assert.equal(results.filter(result => result.participated && result.outcome === "lose").length, 3);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Neon Bomberman 2v2 keeps teammates immune to friendly fire and ends immediately on team wipe", () => {
  const seats = [
    { id: "b1", side: 0 },
    { id: "o1", side: 1 },
    { id: "b2", side: 0 },
    { id: "o2", side: 1 }
  ];
  const arena = new Arena(bomberFactory, BOMBERMAN_ID, 42, 1, seats);
  arena.start();

  const initial = arena.panel(0).scene as BombermanScene;
  assert.equal(initial.kind, "bomberman");
  assert.equal(initial.mode, "2v2");
  assert.equal(initial.players.length, 4);
  assert.ok(initial.players.every(p => !p.isBot));

  // 序列化注入：b1 在 (2,1) 放炸弹，b2 站在 (3,1) 吃队友火焰；b1 先往左走到 (1,1) 再往下拐到 (1,2) 躲在柱子 (2,2) 后
  const raw = JSON.parse(arena.serialize());
  for (const [c, r] of [[1, 1], [2, 1], [3, 1], [1, 2]]) raw.tiles[r * 13 + c] = ".";
  raw.players[0].x = 2.5; raw.players[0].y = 1.5; // b1 (side 0)
  raw.players[2].x = 3.5; raw.players[2].y = 1.5; // b2 (side 0 队友)
  raw.players[1].x = 11.5; raw.players[1].y = 1.5;
  raw.players[3].x = 11.5; raw.players[3].y = 9.5;
  const restored = new Arena(bomberFactory, BOMBERMAN_ID, 42, 1, seats, JSON.stringify(raw));

  assert.equal(restored.input(0, "b1", { kind: "action", action: "bomb" }, 100, 100).played, true);
  restored.input(0, "b1", { kind: "action", action: "hold-left" }, 120, 120);
  restored.tick(520, 520, new Set([0, 1]));
  restored.input(0, "b1", { kind: "action", action: "hold-down" }, 540, 540);
  restored.tick(1100, 1100, new Set([0, 1]));
  restored.input(0, "b1", { kind: "action", action: "release" }, 1120, 1120);

  // 推到 2250ms 引爆（2000ms 引信 + 火焰生效）
  restored.tick(2250, 2250, new Set([0, 1]));
  const afterBlast = restored.panel(0).scene as BombermanScene;
  const blue1 = afterBlast.players.find(p => p.id === "side-0#0")!;
  const blue2 = afterBlast.players.find(p => p.id === "side-0#1")!;
  assert.equal(blue1.alive, true, "b1 躲到柱子后应存活");
  assert.equal(blue2.alive, true, "2v2 模式下队友 b2 必须免疫 b1 的炸弹火焰");
  assert.equal(restored.result(new Set([0, 1])), undefined);

  // 接着测试淘汰对方全部 2 名橙队成员后立刻获胜（b1 在 (10,1) 放弹炸 (11,1) 的 o1、o2，自己左移至 (9,1) 再下拐至 (9,2)）
  const raw2 = JSON.parse(restored.serialize());
  raw2.flames = [];
  raw2.bombs = [];
  raw2.players[0].activeBombs = 0;
  for (const [c, r] of [[9, 1], [10, 1], [11, 1], [9, 2]]) raw2.tiles[r * 13 + c] = ".";
  raw2.players[0].x = 10.5; raw2.players[0].y = 1.5; // b1
  raw2.players[1].x = 11.5; raw2.players[1].y = 1.5; // o1
  raw2.players[3].x = 11.5; raw2.players[3].y = 1.5; // o2
  const wipeArena = new Arena(bomberFactory, BOMBERMAN_ID, 42, 1, seats, JSON.stringify(raw2));
  wipeArena.input(0, "b1", { kind: "action", action: "bomb" }, 2400, 2400);
  wipeArena.input(0, "b1", { kind: "action", action: "hold-left" }, 2420, 2420);
  wipeArena.tick(2850, 2850, new Set([0, 1]));
  wipeArena.input(0, "b1", { kind: "action", action: "hold-down" }, 2870, 2870);
  wipeArena.tick(3400, 3400, new Set([0, 1]));
  wipeArena.input(0, "b1", { kind: "action", action: "release" }, 3420, 3420);
  wipeArena.tick(4600, 4600, new Set([0, 1]));

  const wipeResult = wipeArena.result(new Set([0, 1]));
  assert.deepEqual(wipeResult, { winner: 0, reason: "goal" });
});

test("Neon Bomberman 1v1v1v1 assigns 4 corners independently and declares last survivor winner", () => {
  const seats = [
    { id: "p0", side: 0 },
    { id: "p1", side: 1 },
    { id: "p2", side: 2 },
    { id: "p3", side: 3 }
  ];
  const arena = new Arena(bomberFactory, BOMBERMAN_ID, 101, 1, seats);
  arena.start();

  const scene = arena.panel(0).scene as BombermanScene;
  assert.equal(scene.mode, "1v1v1v1");
  assert.deepEqual(scene.players.map(p => p.side), [0, 1, 2, 3]);

  // 无效输入不推进时钟
  const before = arena.serialize();
  assert.equal(arena.input(0, "p0", { kind: "answer", questionId: 1, value: "42" }, 500, 500).changed, false);
  assert.equal(arena.serialize(), before);

  // 模拟 p1、p2 已淘汰，p0 在 (2,1) 放弹炸 (3,1) 的 p3，自己躲至 (1,2)
  const raw = JSON.parse(arena.serialize());
  raw.players[1].alive = false;
  raw.players[2].alive = false;
  raw.players[0].x = 2.5; raw.players[0].y = 1.5;
  raw.players[3].x = 3.5; raw.players[3].y = 1.5;
  for (const [c, r] of [[1, 1], [2, 1], [3, 1], [1, 2]]) raw.tiles[r * 13 + c] = ".";
  const ffaArena = new Arena(bomberFactory, BOMBERMAN_ID, 101, 1, seats, JSON.stringify(raw));

  ffaArena.input(0, "p0", { kind: "action", action: "bomb" }, 100, 100);
  ffaArena.input(0, "p0", { kind: "action", action: "hold-left" }, 120, 120);
  ffaArena.tick(520, 520, new Set([0, 1, 2, 3]));
  ffaArena.input(0, "p0", { kind: "action", action: "hold-down" }, 540, 540);
  ffaArena.tick(1100, 1100, new Set([0, 1, 2, 3]));
  ffaArena.clearHeldControls("p0");
  ffaArena.tick(2300, 2300, new Set([0, 1, 2, 3]));

  const res = ffaArena.result(new Set([0, 1, 2, 3]));
  assert.deepEqual(res, { winner: 0, reason: "goal" });
});

test("Neon Bomberman starts clockwise spiral wall shrink at 35s and crushes corners before 60s", () => {
  const seats = [
    { id: "p0", side: 0 },
    { id: "p1", side: 1 },
    { id: "p2", side: 2 },
    { id: "p3", side: 3 }
  ];
  const arena = new Arena(bomberFactory, BOMBERMAN_ID, 77, 1, seats);
  arena.start();

  arena.tick(34_000, 34_000, new Set([0, 1, 2, 3]));
  const beforeShrink = arena.panel(0).scene as BombermanScene;
  assert.equal(beforeShrink.shrinkStep, 0);

  // 推进到 35_300ms：第一格 (1,1) 已被高能死墙压毁，站在左上的 p0 被淘汰
  arena.tick(35_300, 35_300, new Set([0, 1, 2, 3]));
  const shrinking = arena.panel(0).scene as BombermanScene;
  assert.ok(shrinking.shrinkStep >= 1);
  assert.equal(shrinking.tiles[1 * 13 + 1], "S");
  assert.equal(shrinking.players[0].alive, false);

  // 推进至 60s 内：外圈四角全部被螺旋死墙吞噬，必在 60s 内决出胜负
  arena.tick(GAME_MS, GAME_MS, new Set([0, 1, 2, 3]));
  const finalScene = arena.panel(0).scene as BombermanScene;
  assert.equal(finalScene.finished, true);
  assert.ok(arena.result(new Set([0, 1, 2, 3]), true) !== undefined);
});

test("Practice 2-controller mode auto-fills 2 bots for full 4-corner 2v2 and 1v1v1v1 matches", () => {
  const seats = [{ id: "P1", side: 0 }, { id: "P2", side: 1 }];
  const teamArena = new Arena(bomberFactory, BOMBERMAN_ID, 100, 1, seats);
  const teamScene = teamArena.panel(0).scene as BombermanScene;
  assert.equal(teamScene.mode, "2v2");
  assert.equal(teamScene.players.length, 4);
  assert.equal(teamScene.players.filter(p => p.isBot).length, 2);

  const ffaArena = new Arena(bomberFactory, BOMBERMAN_ID, 101, 1, seats);
  const ffaScene = ffaArena.panel(0).scene as BombermanScene;
  assert.equal(ffaScene.mode, "1v1v1v1");
  assert.equal(ffaScene.players.length, 4);
  assert.deepEqual(ffaScene.players.map(p => p.side), [0, 1, 2, 3]);
  assert.equal(ffaScene.players.filter(p => p.isBot).length, 2);
});
