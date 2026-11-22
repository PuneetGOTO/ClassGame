import assert from "node:assert/strict";
import test from "node:test";
import { Arena } from "../apps/server/src/arena";
import { selectMatch, type Candidate } from "../apps/server/src/matchmaking";
import { plugins } from "../local-games/registry";
import { CANDY_TETRIS_ID, GAME_MS } from "../packages/shared/catalog";
import type { CandyTetrisScene } from "../packages/shared/protocol";
import { MATCH_WAIT_MS } from "../packages/shared/rules";

const candyFactory = plugins.get(CANDY_TETRIS_ID)!;

function candidate(id: string, queuedAt = 0): Candidate {
  return { id, step: 1, queuedAt, games: new Set(), lastFloor: 4 };
}

test("Candy Tetris restricts matchmaking strictly to 1v1 (2 players max)", () => {
  const rooms = [{ id: "STATION-18", gameId: CANDY_TETRIS_ID, floor: 4 as const }];
  const waiting = [candidate("p1"), candidate("p2"), candidate("p3"), candidate("p4")];
  const matched = selectMatch(waiting, rooms, MATCH_WAIT_MS + 500);
  assert.ok(matched);
  assert.equal(matched.stationId, "STATION-18");
  assert.equal(matched.players.length, 2, "马卡龙消行仅支持 1v1，最多撮合 2 人");
});

test("Candy Tetris deals identical 7-bag pieces, supports fast drop/rotate/hard-drop and 40s fever acceleration", () => {
  const seats = [{ id: "p1", side: 0 }, { id: "p2", side: 1 }];
  const arena = new Arena(candyFactory, CANDY_TETRIS_ID, 42, 1, seats);
  arena.start();

  const initial = arena.panel(0).scene as CandyTetrisScene;
  assert.equal(initial.kind, "candy-tetris");
  assert.equal(initial.boards[0].piece?.type, initial.boards[1].piece?.type, "1v1 双方起手方块必须完全公平一致");
  assert.equal(initial.boards[0].nextType, initial.boards[1].nextType);
  assert.equal(initial.dropIntervalMs, 460, "快节奏开局下落间隔应为 460ms");

  // 无效输入不推进时钟
  const before = arena.serialize();
  assert.equal(arena.input(0, "p1", { kind: "answer", questionId: 1, value: "10" }, 500, 500).changed, false);
  assert.equal(arena.serialize(), before);

  // p1 一键瞬降立即得分并锁定
  assert.equal(arena.input(0, "p1", { kind: "action", action: "hard-drop" }, 100, 100).played, true);
  const afterDrop = arena.panel(0).scene as CandyTetrisScene;
  assert.ok(afterDrop.scores[0] > 0);
  assert.equal(afterDrop.boards[0].lastLockSeq, 1);

  // 推进至第 40 秒开启甜蜜狂热加速（220ms/格）
  const rawFever = JSON.parse(arena.serialize());
  rawFever.lastElapsed = 39_500;
  const feverArena = new Arena(candyFactory, CANDY_TETRIS_ID, 42, 1, seats, JSON.stringify(rawFever));
  feverArena.tick(40_200, 40_200, new Set([0, 1]));
  const feverScene = feverArena.panel(0).scene as CandyTetrisScene;
  assert.equal(feverScene.fever, true);
  assert.equal(feverScene.dropIntervalMs, 220);
});

test("Candy Tetris fires candy garbage lines when clearing 2+ rows and settles on top-out or 60s score", () => {
  const seats = [{ id: "p1", side: 0 }, { id: "p2", side: 1 }];
  const arena = new Arena(candyFactory, CANDY_TETRIS_ID, 77, 2, seats);
  arena.start();

  // 构造 p1 底部两行各缺第 0 列，并让当前块为竖 I 型放在第 0 列，一键瞬降触发双行消行 -> 向 p2 发射糖果炮弹！
  const raw = JSON.parse(arena.serialize());
  raw.boards[0].grid = new Array(200).fill(".");
  for (let r = 18; r <= 19; r++) {
    for (let c = 1; c < 10; c++) raw.boards[0].grid[r * 10 + c] = "Z";
  }
  raw.boards[0].piece = {
    type: "I",
    shape: [[1], [1], [1], [1]],
    x: 0,
    y: 0
  };
  raw.boards[1].grid = new Array(200).fill(".");
  const match = new Arena(candyFactory, CANDY_TETRIS_ID, 77, 2, seats, JSON.stringify(raw));

  match.input(0, "p1", { kind: "action", action: "hard-drop" }, 200, 200);
  const afterClear = match.panel(0).scene as CandyTetrisScene;
  assert.equal(afterClear.boards[0].lines, 2);
  assert.ok(afterClear.lastAttack && afterClear.lastAttack.fromSide === 0 && afterClear.lastAttack.toSide === 1);
  assert.equal(afterClear.boards[1].lastGarbageCount, 1);
  assert.ok(afterClear.boards[1].grid.slice(190).includes("X"), "p2 底部应顶起焦糖饼干干扰行");

  // 满 60 秒按积分判胜（p1 分高）
  const result60 = match.result(new Set([0, 1]), true);
  assert.deepEqual(result60, { winner: 0, reason: "timeout" });

  // 测试对手中路堆满顶出边界时立即提前 KO 判胜
  const rawKo = JSON.parse(match.serialize());
  rawKo.boards[1].grid = new Array(200).fill(".");
  for (let r = 0; r < 20; r++) {
    rawKo.boards[1].grid[r * 10 + 4] = "X";
    rawKo.boards[1].grid[r * 10 + 5] = "X";
  }
  rawKo.boards[1].piece = { type: "O", shape: [[1, 1], [1, 1]], x: 4, y: -1 };
  const koArena = new Arena(candyFactory, CANDY_TETRIS_ID, 77, 2, seats, JSON.stringify(rawKo));
  koArena.input(1, "p2", { kind: "action", action: "hard-drop" }, 300, 300);
  assert.deepEqual(koArena.result(new Set([0, 1])), { winner: 0, reason: "goal" });
  assert.ok(GAME_MS === 60_000);
});
