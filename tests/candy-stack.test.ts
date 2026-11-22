import assert from "node:assert/strict";
import test from "node:test";
import { Arena } from "../apps/server/src/arena";
import { selectMatch, type Candidate } from "../apps/server/src/matchmaking";
import { hostKey } from "../apps/server/src/config";
import { plugins } from "../local-games/registry";
import { CANDY_COLUMNS, CANDY_ROWS, CANDY_STACK_ID, GAME_MS, WATER_SORT_ID } from "../packages/shared/catalog";
import type { CandyStackScene } from "../packages/shared/protocol";
import { MATCH_WAIT_MS } from "../packages/shared/rules";
import { credentials, harness, send } from "./socket-helper";

const candyFactory = plugins.get(CANDY_STACK_ID)!;

function candidate(id: string, queuedAt = 0): Candidate {
  return { id, step: 1, queuedAt, games: new Set(), lastFloor: 4 };
}

test("Candy Stack restricts matchmaking strictly to 1v1 (2 players max)", () => {
  const rooms = [{ id: "STATION-05", gameId: CANDY_STACK_ID, floor: 3 as const }];
  const waiting = [candidate("p1"), candidate("p2"), candidate("p3"), candidate("p4")];
  const matched = selectMatch(waiting, rooms, MATCH_WAIT_MS + 500);
  assert.ok(matched);
  assert.equal(matched.stationId, "STATION-05");
  assert.equal(matched.players.length, 2, "马卡龙消行仅支持 1v1，最多撮合 2 人");
});

test("Candy Stack deals identical pieces, responds to the joystick, and speeds up after 40s", () => {
  const seats = [{ id: "p1", side: 0 }, { id: "p2", side: 1 }];
  const arena = new Arena(candyFactory, CANDY_STACK_ID, 42, 1, seats);
  arena.start();

  const initial = arena.panel(0).scene as CandyStackScene;
  assert.equal(initial.kind, "candy-stack");
  assert.equal(initial.boards[0].piece?.type, initial.boards[1].piece?.type, "1v1 双方起手方块必须完全公平一致");
  assert.equal(initial.boards[0].nextType, initial.boards[1].nextType);
  assert.equal(initial.dropIntervalMs, 460, "快节奏开局下落间隔应为 460ms");

  // 无效输入不推进时钟
  const before = arena.serialize();
  assert.equal(arena.input(0, "p1", { kind: "answer", questionId: 1, value: "10" }, 500, 500).changed, false);
  assert.equal(arena.serialize(), before);

  // p1 一键瞬降立即得分并锁定
  assert.equal(arena.input(0, "p1", { kind: "action", action: "hard-drop" }, 100, 100).played, true);
  const afterDrop = arena.panel(0).scene as CandyStackScene;
  assert.ok(afterDrop.scores[0] > 0);
  assert.equal(afterDrop.boards[0].lastLockSeq, 1);

  const y = afterDrop.boards[0].piece!.y;
  const online = new Set([0, 1]);
  assert.equal(arena.input(0, "p1", { kind: "action", action: "hold-down" }, 120, 120).played, true);
  arena.tick(260, 260, online);
  const afterSoftDrop = arena.panel(0).scene as CandyStackScene;
  assert.ok(afterSoftDrop.boards[0].piece!.y > y);
  const x = afterSoftDrop.boards[0].piece!.x;
  arena.input(0, "p1", { kind: "action", action: "hold-left" }, 270, 270);
  arena.input(0, "p1", { kind: "action", action: "release" }, 280, 280);
  arena.tick(420, 420, online);
  const afterRelease = arena.panel(0).scene as CandyStackScene;
  assert.equal(afterRelease.boards[0].piece!.x, x - 1);
  assert.equal(afterRelease.boards[0].piece!.y, afterSoftDrop.boards[0].piece!.y);

  // 推进至第 40 秒开启甜蜜狂热加速（220ms/格）
  const rawFever = JSON.parse(arena.serialize());
  rawFever.lastElapsed = 39_500;
  const feverArena = new Arena(candyFactory, CANDY_STACK_ID, 42, 1, seats, JSON.stringify(rawFever));
  feverArena.tick(40_200, 40_200, new Set([0, 1]));
  const feverScene = feverArena.panel(0).scene as CandyStackScene;
  assert.equal(feverScene.fever, true);
  assert.equal(feverScene.dropIntervalMs, 220);
});

test("Candy Stack fires candy garbage lines when clearing 2+ rows and settles on top-out or 60s score", () => {
  const seats = [{ id: "p1", side: 0 }, { id: "p2", side: 1 }];
  const arena = new Arena(candyFactory, CANDY_STACK_ID, 77, 2, seats);
  arena.start();

  // 构造 p1 底部两行各缺第 0 列，并让当前块为竖 I 型放在第 0 列，一键瞬降触发双行消行 -> 向 p2 发射糖果炮弹！
  const raw = JSON.parse(arena.serialize());
  const finalRow = (CANDY_ROWS - 1) * CANDY_COLUMNS;
  const cells = CANDY_COLUMNS * CANDY_ROWS;
  raw.boards[0].grid = new Array(cells).fill(".");
  for (let r = CANDY_ROWS - 2; r < CANDY_ROWS; r++) {
    for (let c = 1; c < CANDY_COLUMNS; c++) raw.boards[0].grid[r * CANDY_COLUMNS + c] = "Z";
  }
  raw.boards[0].piece = {
    type: "I",
    shape: [[1], [1], [1], [1]],
    x: 0,
    y: 0
  };
  raw.boards[1].grid = new Array(cells).fill(".");
  const match = new Arena(candyFactory, CANDY_STACK_ID, 77, 2, seats, JSON.stringify(raw));

  match.input(0, "p1", { kind: "action", action: "hard-drop" }, 200, 200);
  const afterClear = match.panel(0).scene as CandyStackScene;
  assert.equal(afterClear.boards[0].lines, 2);
  assert.ok(afterClear.lastAttack && afterClear.lastAttack.fromSide === 0 && afterClear.lastAttack.toSide === 1);
  assert.equal(afterClear.boards[1].lastGarbageCount, 1);
  assert.ok(afterClear.boards[1].grid.slice(finalRow).includes("X"), "p2 底部应顶起焦糖饼干干扰行");

  // 满 60 秒按积分判胜（p1 分高）
  const result60 = match.result(new Set([0, 1]), true);
  assert.deepEqual(result60, { winner: 0, reason: "timeout" });

  // 测试对手中路堆满顶出边界时立即提前 KO 判胜
  const rawKo = JSON.parse(match.serialize());
  rawKo.boards[1].grid = new Array(cells).fill(".");
  for (let r = 0; r < CANDY_ROWS; r++) {
    rawKo.boards[1].grid[r * CANDY_COLUMNS + 4] = "X";
    rawKo.boards[1].grid[r * CANDY_COLUMNS + 5] = "X";
  }
  rawKo.boards[1].piece = { type: "O", shape: [[1, 1], [1, 1]], x: 4, y: -1 };
  const koArena = new Arena(candyFactory, CANDY_STACK_ID, 77, 2, seats, JSON.stringify(rawKo));
  koArena.input(1, "p2", { kind: "action", action: "hard-drop" }, 300, 300);
  assert.deepEqual(koArena.result(new Set([0, 1])), { winner: 0, reason: "goal" });
  assert.ok(GAME_MS === 60_000);
});

test("HOST-05 runs and settles a formal Candy Stack duel", async () => {
  const service = await harness();
  try {
    const oldScreen = await service.connect();
    const registration = await send(oldScreen, "host:register", {
      hostId: "HOST-05", key: hostKey(credentials.hostSecret, "HOST-05"), screenVersion: 5
    });
    assert.ok(!registration.ok && registration.code === "host-refresh");
    await service.host("HOST-05");
    const campus = service.campus.snapshot();
    assert.equal(campus.games.length, 20);
    assert.ok(!campus.games.some(game => game.id === WATER_SORT_ID));
    const station = campus.stations.find(item => item.hostId === "HOST-05")!;
    assert.deepEqual([station.floor, station.name, station.gameId], [3, "306 室", CANDY_STACK_ID]);

    const players = await Promise.all([service.player("消行選手甲"), service.player("消行選手乙")]);
    const lobby = await service.match(players);
    assert.equal(lobby.gameId, CANDY_STACK_ID);
    const room = await service.begin(players, lobby.stationId);
    for (const player of players) await service.control(player, { kind: "action", action: "hard-drop" });
    service.step(600);
    await service.control(players[0], { kind: "action", action: "hard-drop" });
    const scene = service.panel(players[0].id).scene as CandyStackScene;
    const winnerSide = room.members.find(member => member.id === players[0].id)!.side;
    assert.ok(winnerSide === 0 || winnerSide === 1);
    assert.ok(scene.scores[winnerSide] > scene.scores[1 - winnerSide]);

    assert.equal(room.deadline! - room.startedAt!, GAME_MS);
    for (let drop = 0; drop < CANDY_ROWS && service.campus.hostView("HOST-05").room?.status === "running"; drop++) {
      service.step(170);
      await service.control(players[1], { kind: "action", action: "hard-drop" });
    }
    const finished = service.campus.hostView("HOST-05").room!;
    assert.equal(finished.status, "finished");
    assert.equal(finished.reason, "goal");
    assert.deepEqual(players.map(player => service.store.officialFor(player.id).map(result => result.gameId)),
      [[CANDY_STACK_ID], [CANDY_STACK_ID]]);
    assert.deepEqual(service.store.leaderboard().players.map(player => [player.name, player.totalScore]),
      [["消行選手甲", 2], ["消行選手乙", 1]]);
  } finally {
    await service.close();
  }
});
