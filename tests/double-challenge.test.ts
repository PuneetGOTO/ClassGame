import assert from "node:assert/strict";
import { test } from "node:test";
import { ANSWER_COOLDOWN_MS, DOUBLE_END_MS } from "../packages/shared/rules";
import type { DoubleChallenge, Quiz } from "../packages/shared/protocol";
import { harness, ok } from "./socket-helper";
import { arithmetic } from "./solve";

test("one active controller draws the weighted challenge and its opponent can win independently", async () => {
  const service = await harness();
  try {
    const a = await service.player("甲");
    const b = await service.player("乙");
    const outsider = await service.connect();
    await ok(outsider, "campus:watch", null);
    let leaked = false;
    outsider.on("game:double-challenge", () => { leaked = true; });
    // Established results make the next match tier two for both players.
    for (const number of ["02", "03"]) {
      const display = await service.host("HOST-" + number);
      const lobby = await service.match([a,b]);
      await service.begin([a,b], lobby.stationId);
      await service.operate(a.socket,a.id);
      await service.operate(b.socket,b.id);
      service.step(60_000);
      display.disconnect();
      service.step(5500);
    }
    assert.equal(service.store.playedGames(a.id).length, 2);
    await service.host("HOST-18");
    assert.equal((await service.admin("/rules", { doubleChance: 100 }, "PUT")).status, 200);
    const lobby = await service.match([a,b]);
    assert.equal(lobby.gameId, "game-18");
    assert.equal(lobby.match?.mode, "duel");
    assert.equal(lobby.doubleChallenge, null);
    await service.begin([a,b], lobby.stationId);
    await service.operate(a.socket,a.id);
    await service.operate(b.socket,b.id);
    const event = new Promise<DoubleChallenge>(resolve => a.socket.once("game:double-challenge", message => resolve(message.challenge)));
    service.step(DOUBLE_END_MS);
    const selected = await event;
    assert.equal(selected.tier, 2);
    const losing = selected.playerId === a.id ? a : b;
    const winning = losing === a ? b : a;
    while (service.campus.playerView(winning.id).room) {
      const scene = service.panel(winning.id).scene as Quiz;
      service.step(ANSWER_COOLDOWN_MS);
      await service.control(winning, arithmetic(scene.prompt!));
    }
    const result = service.store.resultsForSession(lobby.id);
    const lost = result.find(row => row.playerId === losing.id)!;
    const won = result.find(row => row.playerId === winning.id)!;
    assert.deepEqual([lost.step, lost.baseAwarded, lost.awarded, lost.doublePoints], [3, 2, -4, true]);
    assert.deepEqual([won.step, won.baseAwarded, won.awarded, won.doublePoints], [3, 4, 4, false]);
    assert.equal(leaked, false);
  } finally { await service.close(); }
});

test("a selected double challenge appears and scores when a 1-question match finishes before the draw time", async () => {
  const service = await harness();
  try {
    await service.host("HOST-11");
    const [a,b] = await Promise.all([service.player("快答甲"), service.player("快答乙")]);
    await service.admin("/rules", { doubleChance: 100 }, "PUT");
    const lobby = await service.match([a,b]);
    const room = await service.begin([a,b], lobby.stationId);
    const event = new Promise<DoubleChallenge>(resolve => a.socket.once("game:double-challenge", message => resolve(message.challenge)));
    const first = (service.panel(a.id).scene as Quiz).prompt!;
    await service.control(a, { kind: "answer", questionId: first.id, value: "1" });
    const second = (service.panel(b.id).scene as Quiz).prompt!;
    const pair = second.numbers!.find((number, index, values) => values.indexOf(number) !== index)!;
    await service.control(b, { kind: "answer", questionId: second.id, value: "3*8+" + pair + "-" + pair });
    const selected = service.campus.hostView(room.hostId).room!.doubleChallenge;
    assert.ok(selected);
    assert.deepEqual(await event, selected);
    assert.ok(service.time() < room.startedAt! + 6000);
    const results = service.store.resultsForSession(room.id);
    const awarded = results.filter(result => result.doublePoints);
    assert.equal(awarded.length, 1);
    assert.equal(awarded[0].playerId, selected.playerId);
    assert.equal(awarded[0].awarded, selected.playerId === a.id ? -2 : 4);
  } finally { await service.close(); }
});
