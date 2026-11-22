import assert from "node:assert/strict";
import { test } from "node:test";
import { GAMES, fixedId } from "../packages/shared/catalog";
import { ROUTE_LENGTH, routeTier } from "../packages/shared/route";
import { selectMatch, type Candidate } from "../apps/server/src/matchmaking";
import { harness, send } from "./socket-helper";

test("matchmaking leaves a pair for the next room and prioritizes compatible unplayed games", () => {
  const waiting: Candidate[] = Array.from({ length: 5 }, (_, index) => ({
    id: String(index), step: 2, queuedAt: 0, games: new Set(["game-01"]), lastFloor: 3
  }));
  const rooms = [
    { id: "STATION-01", gameId: "game-01", floor: 3 },
    { id: "STATION-02", gameId: "game-02", floor: 3 },
    { id: "STATION-11", gameId: "game-11", floor: 4 }
  ] as const;
  const first = selectMatch(waiting, [...rooms], 10_000)!;
  assert.equal(first.players.length, 3);
  assert.equal(first.stationId, "STATION-02");
  const second = selectMatch(waiting.filter(player => !first.players.includes(player)),
    rooms.filter(room => room.id !== first.stationId), 10_000)!;
  assert.equal(second.players.length, 2);
  assert.equal(second.stationId, "STATION-11");
  const levels = waiting.slice(0, 4).map((player, index) => ({ ...player, step: index === 3 ? 6 : 2 }));
  assert.equal(selectMatch(levels, [...rooms], 3000), undefined);
  assert.equal(selectMatch(levels, [...rooms], 10_000)?.players.length, 4);
});

test("two players complete ten different randomly assigned stations and always use their current room code", async () => {
  const service = await harness();
  try {
    await Promise.all(GAMES.map((_game, i) => service.host(fixedId("HOST", i + 1))));
    const a = await service.player("十關甲");
    const b = await service.player("十關乙");
    assert.deepEqual(a.state.route, { completed: 0, searching: false, next: null });
    const played = new Set<string>();
    for (let step = 1; step <= ROUTE_LENGTH; step++) {
      const lobby = await service.match([a,b]);
      const view = service.campus.playerView(a.id);
      assert.equal(view.route.completed, step - 1);
      assert.equal(view.route.next?.step, step);
      assert.equal(view.route.next?.tier, routeTier(step));
      assert.equal(played.has(lobby.gameId), false);
      played.add(lobby.gameId);
      if (step === 1) {
        const other = service.store.stationRows().find(station => station.id !== lobby.stationId)!;
        const wrong = await service.attemptStation(a.socket, other.id);
        assert.ok(!wrong.ok && wrong.code === "wrong-route");
      }
      await service.begin([a,b], lobby.stationId);
      await service.operate(a.socket, a.id);
      await service.operate(b.socket, b.id);
      service.step(60_000);
      const results = service.store.resultsForSession(lobby.id);
      assert.equal(results.length, 2);
      assert.ok(results.every(result => result.step === step && result.baseAwarded >= routeTier(step)));
    }
    assert.equal(played.size, 10);
    for (const player of [a,b]) {
      const state = service.campus.playerView(player.id);
      assert.deepEqual(state.route, { completed: 10, searching: false, next: null });
      assert.equal(state.results.length, 10);
      assert.equal(service.store.playedGames(player.id).length, 10);
      const again = await send(player.socket, "match:find", null);
      assert.ok(!again.ok && again.code === "course-complete");
    }
  } finally { await service.close(); }
});
