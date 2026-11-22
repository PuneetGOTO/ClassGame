import assert from "node:assert/strict";
import { test } from "node:test";
import { GAMES, fixedId } from "../packages/shared/catalog";
import { ROUTE_LENGTH, routeTier } from "../packages/shared/route";
import { selectMatch, type Candidate } from "../apps/server/src/matchmaking";
import { harness, ok, send } from "./socket-helper";

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

test("a lone player can finish ten different games with a completed volunteer, with no points awarded to the volunteer", async () => {
  const service = await harness();
  try {
    await Promise.all(GAMES.map((_game, i) => service.host(fixedId("HOST", i + 1))));
    const a = await service.player("十關甲");
    const b = await service.player("十關乙");
    const c = await service.player("十關丙");
    assert.deepEqual(a.state.route, { completed: 0, searching: false, next: null });
    const played = new Set<string>();
    let previous: { id: string; stationId: string; gameId: string } | undefined;
    for (let step = 1; step <= ROUTE_LENGTH; step++) {
      const players = step === 9 ? [a,b] : [a,b,c];
      const lobby = await service.match(players);
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
      await service.begin(players, lobby.stationId);
      for (const player of players) await service.operate(player.socket, player.id);
      service.step(60_000);
      const results = service.store.resultsForSession(lobby.id);
      assert.equal(results.length, players.length);
      assert.ok(results.filter(result => result.playerId !== c.id)
        .every(result => result.step === step && result.baseAwarded >= routeTier(step)));
      if (step === 9) previous = lobby;
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
    await ok(c.socket, "match:find", null);
    service.step(60_000);
    assert.equal(service.campus.playerView(c.id).route.completed, 9);
    assert.equal(service.campus.playerView(c.id).room, null);
    const volunteerScore = service.campus.playerView(a.id).player.totalScore;
    assert.equal((await ok(a.socket, "match:assist", null)).route.assisting, true);
    service.step(500);
    const assisted = service.campus.playerView(c.id).room!;
    assert.equal(assisted.match?.mode, "duel");
    assert.equal(assisted.members.find(member => member.id === a.id)?.assisting, true);
    assert.equal(await service.begin([a,c], assisted.stationId).then(room => room.id), assisted.id);
    await service.operate(a.socket, a.id);
    await service.operate(c.socket, c.id);
    service.step(60_000);
    const helper = service.store.resultsForSession(assisted.id).find(result => result.playerId === a.id)!;
    assert.deepEqual([helper.participated, helper.assisting, helper.awarded, helper.step], [true, true, 0, null]);
    assert.equal(service.campus.playerView(a.id).player.totalScore, volunteerScore);
    assert.equal(service.campus.playerView(c.id).route.completed, 10);

    assert.ok(previous);
    const voidPath = "/sessions/" + previous.id + "/void";
    const earlierResults = service.store.resultsForSession(previous.id);
    const unauthenticated = await fetch(service.origin + "/api/admin" + voidPath, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "不符合資格" })
    });
    assert.equal(unauthenticated.status, 401);
    const request = await service.admin(voidPath, { reason: "大螢幕判分錯誤" });
    assert.equal(request.status, 200);
    const firstVoid = await request.json();
    service.step(5500);
    assert.deepEqual(await (await service.admin(voidPath, { reason: "重送請求" })).json(), firstVoid);
    assert.equal(service.campus.adminView().audit.filter(entry => entry.action === "session.void").length, 1);
    assert.deepEqual(service.store.resultsForSession(previous.id), earlierResults);
    assert.deepEqual(service.campus.playerView(a.id).results.map(result => result.step), [1,2,3,4,5,6,7,8,10]);
    assert.equal(service.campus.playerView(a.id).player.totalScore,
      volunteerScore - earlierResults.find(result => result.playerId === a.id)!.awarded);
    service.store.run("UPDATE campus_stations SET open=(station_id=?)", previous.stationId);
    const replay = await service.match([a,b]);
    assert.equal(replay.gameId, previous.gameId);
    assert.equal(service.campus.playerView(a.id).route.next?.step, 9);
    await service.begin([a,b], replay.stationId);
    await service.operate(a.socket, a.id);
    await service.operate(b.socket, b.id);
    service.step(60_000);
    assert.deepEqual(service.campus.playerView(a.id).results.map(result => result.step), [1,2,3,4,5,6,7,8,9,10]);
    assert.equal(service.campus.playerView(c.id).route.completed, 10);
  } finally { await service.close(); }
});
