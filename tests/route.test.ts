import assert from "node:assert/strict";
import { test } from "node:test";
import { GAMES, STATION_COUNT, fixedId } from "../packages/shared/catalog";
import { routePoints, routeTier } from "../packages/shared/route";
import { harness, ok, send } from "./socket-helper";

test("a randomly assigned course takes exactly 20 played games with one floor change and no skips", async () => {
  const service = await harness();
  try {
    await Promise.all(GAMES.map((_game, i) => service.host(fixedId("HOST", i + 1))));
    const player = await service.player("二十關全程");
    const teammate = await service.player("同隊不同路線", "TEAM-01");
    assert.equal(player.state.player.teamId, teammate.state.player.teamId);
    assert.notEqual(player.state.route.next?.stationId, teammate.state.route.next?.stationId);
    assert.ok(!JSON.stringify(player.state.route).includes("seed"));
    assert.deepEqual(Object.keys(player.state.route).sort(), ["completed", "next"]);
    const floors: number[] = [];
    const games: string[] = [];
    let score = 0;
    for (let step = 1; step <= STATION_COUNT; step++) {
      service.step(5000);
      const state = service.campus.playerView(player.id);
      assert.equal(state.route.completed, step - 1);
      assert.equal(state.player.totalScore, score);
      const next = state.route.next!;
      assert.equal(next.step, step);
      assert.equal(next.tier, routeTier(step));
      games.push(next.gameId);
      const station = service.store.stationRows().find(item => item.id === next.stationId)!;
      assert.equal(station.gameId, next.gameId);
      floors.push(station.floor);
      const lobby = await service.joinStation(player.socket, next.stationId);
      const sessionId = lobby.room!.id;
      const countdown = await ok(player.socket, "game:ready", { sessionId, ready: true });
      assert.equal(countdown.room!.deadline! - countdown.room!.startedAt!, 60_000);
      service.step(3000);
      const own = service.campus.playerView(player.id).room!;
      assert.equal(own.members.length, 1);
      assert.deepEqual(own.course, { step, tier: next.tier });
      assert.ok(own.scene);
      assert.equal(service.campus.hostView(station.hostId).room?.scene, null);
      assert.equal(service.campus.playerView(teammate.id).room, null);
      if (step === 1) {
        const wrong = await service.attemptStation(player.socket, teammate.state.route.next!.stationId);
        assert.ok(!wrong.ok && wrong.code === "wrong-route");
        const wronglyJoined = await service.attemptStation(teammate.socket, next.stationId);
        assert.ok(!wronglyJoined.ok && wronglyJoined.code === "wrong-route");
      }
      const ended = new Promise(resolve => player.socket.once("game:timeout", resolve));
      await service.operate(player.socket, player.id);
      service.step(60_000);
      await ended;
      score += routePoints(next.tier).loss;
      assert.equal(service.campus.playerView(player.id).lastResult?.awarded, routePoints(next.tier).loss);
    }
    assert.equal(new Set(games).size, 20);
    assert.equal(floors.filter((floor, index) => index > 0 && floor !== floors[index - 1]).length, 1);
    const final = service.campus.playerView(player.id);
    assert.deepEqual(final.route, { completed: 20, next: null });
    assert.equal(final.player.totalScore, 50);
    assert.equal(final.results.length, 20);
    assert.equal(service.campus.playerView(teammate.id).route.completed, 0);
    const replay = await service.attemptStation(player.socket, player.state.route.next!.stationId);
    assert.ok(!replay.ok && replay.code === "course-complete");
    const duplicate = await send(player.socket, "game:input", {
      sessionId: final.lastResult!.sessionId, seq: 1000, action: { kind: "move", direction: "up" }
    });
    assert.ok(!duplicate.ok && duplicate.code === "wrong-session");
    assert.equal(service.store.leaderboard().players[0].totalScore, 50);
  } finally {
    await service.close();
  }
});

