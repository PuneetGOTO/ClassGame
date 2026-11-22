import assert from "node:assert/strict";
import { test } from "node:test";
import type { Action, Board, Quiz } from "../packages/shared/protocol";
import { harness, ok, send } from "./socket-helper";
import { arithmetic, move, shortest, solvePipes, solveSokoban } from "./solve";

test("the five priority games can be won through the player's WebSocket and keep the screen private", async () => {
  const service = await harness();
  try {
    const player = await service.player("個人闖關");
    const games = ["01", "03", "10", "14", "18"];
    service.fixtureRoute(player.id, ...games.map(number => "game-" + number));
    for (const [index, number] of games.entries()) {
      const screen = await service.host("HOST-" + number);
      const station = "STATION-" + number;
      const lobby = await service.joinStation(player.socket, station);
      const sessionId = lobby.room!.id;
      const started = new Promise<void>(resolve => screen.once("game:start", view => {
        assert.equal(view.id, sessionId);
        assert.deepEqual(view.course, { step: index + 1, tier: 1 });
        resolve();
      }));
      await ok(player.socket, "game:ready", { sessionId, ready: true });
      await started;
      service.step(3000);
      const room = () => service.campus.playerView(player.id).room!;
      assert.equal(room().members.length, 1);
      assert.equal(service.campus.hostView("HOST-" + number).room?.scene, null);
      assert.ok(service.campus.hostView("HOST-" + number).room?.progress);
      const input = async (action: Action) => {
        service.step(95);
        await ok(player.socket, "game:input", { sessionId, seq: room().seq + 1, action });
      };
      const score = new Promise<void>(resolve => screen.once("score:result", result => {
        assert.equal(result.sessionId, sessionId);
        assert.equal(result.outcome, "win");
        resolve();
      }));
      if (number === "01") {
        for (const action of solveSokoban(room().scene as Board)) await input(action);
      } else if (number === "03") {
        for (const action of solvePipes(room().scene as Board)) await input(action);
      } else if (number === "14") {
        const board = room().scene as Board;
        const from = board.tiles.findIndex(tile => tile.kind === "player");
        const item = board.tiles.findIndex(tile => tile.kind === "crystal");
        const exit = board.tiles.findIndex(tile => tile.kind === "exit");
        for (const direction of [...shortest(board, from, item), ...shortest(board, item, exit)]) await input(move(direction));
      } else {
        const view = () => room().scene as Quiz;
        const goal = room().progress!.target;
        const first = arithmetic(view().prompt!);
        await input(first);
        await ok(player.socket, "game:input", { sessionId, seq: 1, action: first });
        assert.equal(view().correct, 1);
        assert.equal("solution" in view().prompt!, false);
        for (let i = 1; i < goal; i++) await input(arithmetic(view().prompt!));
      }
      await score;
      const playerView = service.campus.playerView(player.id);
      assert.equal(playerView.route.completed, index + 1);
      assert.equal(playerView.lastResult?.awarded, 2);
      assert.equal(playerView.player.totalScore, (index + 1) * 2);
      assert.equal(service.store.teamResult(sessionId), null);
      const played = await service.attemptStation(player.socket, station);
      assert.ok(!played.ok && played.code === "wrong-route");
      const late = await send(player.socket, "game:input", { sessionId, seq: 999, action: move("up") });
      assert.ok(!late.ok && late.code === "wrong-session");
    }
  } finally { await service.close(); }
});
