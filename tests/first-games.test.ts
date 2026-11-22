import assert from "node:assert/strict";
import { test } from "node:test";
import { GAMES } from "../packages/shared/catalog";
import type { Action, Board, Quiz } from "../packages/shared/protocol";
import { ANSWER_COOLDOWN_MS } from "../packages/shared/rules";
import { Arena } from "../apps/server/src/arena";
import { plugins } from "../local-games/registry";
import { isPrime } from "../local-games/game-12";
import { harness, send } from "./socket-helper";
import { arithmetic, directions, move, shortest, solvePipes, solveSokoban } from "./solve";

function answer(scene: Quiz, action: Action): Action {
  assert.equal(action.kind, "answer");
  if (!scene.prompt?.options) return action;
  const index = scene.prompt.options.findIndex(option => option.value === action.value);
  assert.ok(index >= 0);
  return { kind: "choice", questionId: action.questionId, index };
}

test("each of the 20 plugins supplies symmetric but independently controlled side boards", () => {
  for (const game of GAMES) {
    const match = new Arena(plugins.get(game.id)!, game.id, 57, 2, [0, 1, 0, 1]);
    match.start();
    const first = match.panel(0);
    const opponent = match.panel(1);
    assert.ok(first.scene, game.name);
    assert.deepEqual(opponent.scene, first.scene, game.name);
    if (first.scene.kind === "quiz") assert.equal(JSON.stringify(match.remote(0, "p1")).includes("text"), false, game.name);
    else assert.deepEqual(match.remote(0, "p1"), {}, game.name);
    assert.equal(match.input(0, "p1", { kind: "cell", index: 0 }, 0, 0).changed, false);
    const restored = new Arena(plugins.get(game.id)!, game.id, 57, 2, [0, 1], match.serialize());
    assert.deepEqual(restored.panel(0), first);
    assert.deepEqual(restored.panel(1), opponent);
  }
});

test("Rush Hour gives the win to the side whose car is closer to the exit at the deadline", () => {
  const id = "game-04";
  const arena = new Arena(plugins.get(id)!, id, 1, 1, [0, 1]);
  arena.start();
  const act = (side: number, action: Action) => assert.equal(arena.input(side, String(side), action, 1, 1).played, true);
  act(0, { kind: "cursor", direction: "right" });
  act(0, { kind: "action", action: "interact" });
  act(0, move("down"));
  act(0, { kind: "cursor", direction: "left" });
  act(0, { kind: "action", action: "interact" });
  for (let index = 0; index < 4; index++) act(0, move("right"));
  act(1, { kind: "cursor", direction: "right" });
  assert.deepEqual([arena.panel(0).progress?.value, arena.panel(1).progress?.value], [4, 0]);
  assert.equal(arena.result(new Set([0, 1])), undefined);
  assert.deepEqual(arena.result(new Set([0, 1]), true), { winner: 0, reason: "timeout" });
});

for (const number of ["01","03","10","14","18"]) test("HOST-" + number + " accepts controller inputs and settles a winner", async () => {
  const service = await harness();
  try {
    const a = await service.player("挑戰者");
    const b = await service.player("對手");
    const host = await service.host("HOST-" + number);
    const lobby = await service.match([a,b]);
    await service.begin([a,b], lobby.stationId);
    const room = () => service.campus.playerView(a.id).room!;
    assert.equal(room().scene, null);
    assert.equal(room().match!.panels, undefined);
    const unauthorized = await send(host, "game:input", { sessionId: lobby.id, seq: 1, action: move("up") });
    assert.ok(!unauthorized.ok);
    await service.operate(b.socket, b.id);
    const otherBoard = service.panel(b.id).scene;
    const side = room().members.find(member => member.id === a.id)!.side;
    const screen = () => service.panel(a.id).scene!;
    const input = async (action: Action) => {
      service.step(action.kind === "choice" || action.kind === "answer" ? ANSWER_COOLDOWN_MS : 90);
      await service.control(a, action);
    };
    if (number === "01") {
      for (const action of solveSokoban(screen() as Board)) await input(action);
    } else if (number === "03") {
      const board = screen() as Board;
      for (const action of solvePipes(board)) {
        assert.equal(action.kind, "cell");
        const path = shortest(board, service.panel(a.id).cursor!, action.index);
        for (const direction of path) await input({ kind: "cursor", direction });
        await input({ kind: "action", action: "interact" });
      }
    } else if (number === "14") {
      const board = screen() as Board;
      const from = board.tiles.findIndex(tile => tile.kind === "player");
      const item = board.tiles.findIndex(tile => tile.kind === "crystal");
      const exit = board.tiles.findIndex(tile => tile.kind === "exit");
      for (const direction of shortest(board,from,item).concat(shortest(board,item,exit))) await input(move(direction));
    } else {
      while (room()) {
        const scene = screen() as Quiz;
        await input(answer(scene, arithmetic(scene.prompt!)));
      }
    }
    const display = service.campus.hostView("HOST-" + number);
    assert.equal(display.room?.status, "finished");
    assert.equal(display.room?.match?.winner, side);
    assert.deepEqual(display.room?.match?.panels?.find(item => item.side !== side)?.scene, otherBoard);
    assert.deepEqual([service.campus.playerView(a.id).lastResult?.awarded, service.campus.playerView(b.id).lastResult?.awarded], [2,1]);
  } finally { await service.close(); }
});

test("in 2 vs 2 teammates share progress but each has a separate two-second answer wait", async () => {
  const service = await harness();
  try {
    await service.host("HOST-10");
    const players = await Promise.all(Array.from({length:4}, (_,i) => service.player("對戰 " + i)));
    const lobby = await service.match(players);
    const room = await service.begin(players, lobby.stationId);
    assert.equal(room.match?.mode, "doubles");
    const blue = players.filter(player => room.members.find(member => member.id === player.id)?.side === 0);
    const orange = players.filter(player => room.members.find(member => member.id === player.id)?.side === 1);
    assert.equal(blue.length, 2);
    assert.equal(orange.length, 2);
    const snapshot = () => service.campus.hostView("HOST-10").room!.match!.panels!;
    const orangeAnswer = (snapshot()[1].scene as Quiz).prompt!;
    for (const player of orange) await service.control(player, { kind: "choice", questionId: service.panel(player.id).scene!.kind === "quiz"
      ? (service.panel(player.id).scene as Quiz).prompt!.id : orangeAnswer.id, index: 0 });
    const frozen = snapshot()[1].scene;
    const remote = (player: typeof blue[number]) => service.campus.playerView(player.id).room!.match!.remote!;
    for (let i = 0; i < 4; i++) {
      const scene = snapshot()[0].scene as Quiz;
      if (i === 2) {
        const availableAt = service.time() + ANSWER_COOLDOWN_MS;
        assert.deepEqual(blue.map(player => remote(player).answerAvailableAt), [availableAt, availableAt]);
        service.step(ANSWER_COOLDOWN_MS - 1);
        const early = await send(blue[0].socket, "game:input", { sessionId: room.id, seq: 2,
          action: answer(scene, arithmetic(scene.prompt!)) });
        assert.ok(!early.ok && early.code === "answer-cooldown");
        assert.equal((snapshot()[0].scene as Quiz).attempted, 2);
        assert.equal(remote(blue[0]).answerAvailableAt, availableAt);
        service.step(1);
      }
      if (i === 3) service.step(ANSWER_COOLDOWN_MS);
      await service.control(blue[i === 1 ? 1 : 0], answer(scene, arithmetic(scene.prompt!)));
      if (i === 0) assert.equal(remote(blue[1]).answerAvailableAt, undefined);
      if (i < 3) assert.equal((snapshot()[0].scene as Quiz).correct,i+1);
      assert.deepEqual(snapshot()[1].scene,frozen);
    }
    const results = service.store.resultsForSession(room.id);
    assert.ok(results.filter(row => blue.some(player => player.id === row.playerId)).every(row => row.outcome === "win"));
    assert.ok(results.filter(row => orange.some(player => player.id === row.playerId)).every(row => row.outcome === "lose"));
    assert.equal(results.length, 4);
    for (const [index, player] of blue.entries()) {
      const metrics = results.find(row => row.playerId === player.id)!.metrics;
      const own = index === 0 ? 3 : 1;
      assert.deepEqual([metrics.attempted, metrics.correct, metrics.sideAnswers], [own, own, { attempted: 4, correct: 4 }]);
    }
    assert.deepEqual(orange.map(player => results.find(row => row.playerId === player.id)!.metrics.attempted), [1, 1]);
  } finally { await service.close(); }
});

test("a completed prime quiz records a tie and sends both phones results before the clock runs out", async () => {
  const service = await harness();
  try {
    await service.host("HOST-12");
    const a = await service.player("甲");
    const b = await service.player("乙");
    const lobby = await service.match([a,b]);
    const started = await service.begin([a,b], lobby.stationId);
    for (const player of [a,b]) {
      for (let i = 0; i < 5; i++) {
        if (i > 0) service.step(ANSWER_COOLDOWN_MS);
        const scene = service.panel(player.id).scene as Quiz;
        const number = Number(scene.prompt!.text.match(/\d+/)![0]);
        const prime = i < 3 ? isPrime(number) : !isPrime(number);
        await service.control(player, { kind: "choice", questionId: scene.prompt!.id, index: prime ? 0 : 1 });
      }
    }
    assert.ok(service.time() < started.deadline!);
    const room = service.campus.hostView("HOST-12").room!;
    assert.equal(room.status, "finished");
    assert.equal(room.reason, "completed");
    assert.equal(room.match?.winner, null);
    const results = service.store.resultsForSession(lobby.id);
    assert.deepEqual(results.map(result => [result.tied, result.awarded]), [[true, 1], [true, 1]]);
    assert.deepEqual(service.store.leaderboard().players.map(row => [row.wins, row.ties, row.losses, row.totalScore]),
      [[0, 1, 0, 1], [0, 1, 0, 1]]);
    for (const player of [a,b]) {
      const view = service.campus.playerView(player.id);
      assert.equal(view.room, null);
      assert.equal(view.route.completed, 1);
      assert.equal(view.lastResult?.tied, true);
    }
  } finally { await service.close(); }
});
