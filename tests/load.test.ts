import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { GAMES, fixedId } from "../packages/shared/catalog";
import type { Leaderboard, Quiz, RoomView } from "../packages/shared/protocol";
import { harness, ok, send } from "./socket-helper";
import { arithmetic, move } from "./solve";

async function eventually(check: () => boolean, milliseconds = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started >= milliseconds) assert.fail("State did not synchronize within " + milliseconds + " ms");
    await delay(25);
  }
}

test("50 phones and 20 hosts sustain 20 independent rooms, queued players and 60-second deadlines", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "campus-load-"));
  const service = await harness(join(directory, "load.sqlite"), 0, true);
  try {
    const observer = await service.connect();
    const scoreboards: Leaderboard[] = [];
    observer.on("score:leaderboard", board => scoreboards.push(board));
    let unauthorizedStates = 0;
    observer.on("game:state", () => unauthorizedStates++);
    await ok(observer, "campus:watch", null);

    const hosts = await Promise.all(GAMES.map((_game, i) => service.host(fixedId("HOST", i + 1))));
    const players = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      service.player("負載 " + (i + 1), fixedId("TEAM", Math.floor(i / 5) + 1))));
    const initial = service.store.leaderboard();
    assert.equal(initial.players.length, 50);
    assert.equal(initial.teams.length, 10);
    assert.ok(initial.players.every(player => player.totalScore === 0 && player.connected));
    assert.ok(initial.teams.every(team => team.members.length === 5));
    assert.equal(service.campus.adminView().connections.hosts, 20);
    assert.equal(service.campus.adminView().connections.players, 50);
    assert.equal(service.io.sockets.sockets.size, 71);
    const extra = await service.connect();
    const rejected = await send(extra, "player:join", { name: "第 51 位" });
    assert.ok(!rejected.ok && rejected.code === "full");
    extra.disconnect();

    const assignments = new Map<string, typeof players>();
    for (const player of players) {
      const stationId = player.state.route.next!.stationId;
      const assigned = assignments.get(stationId) ?? [];
      assigned.push(player);
      assignments.set(stationId, assigned);
    }
    assert.equal(assignments.size, 20);
    assert.ok([...assignments.values()].every(group => group.length === 2 || group.length === 3));
    const rooms = await Promise.all([...assignments].map(async ([stationId, group]) => {
      const [player, ...queued] = group;
      const lobby = await service.joinStation(player.socket, stationId);
      assert.equal(lobby.room!.members.length, 1);
      for (const [index, waiting] of queued.entries()) {
        const view = await service.joinStation(waiting.socket, stationId);
        assert.equal(view.queue?.position, index + 1);
        assert.equal(view.room, null);
      }
      return { player, stationId, sessionId: lobby.room!.id };
    }));
    const winner = rooms.find(room => room.stationId === "STATION-10")!;
    const starts = new Map<string, RoomView>();
    const timeouts = new Map<string, { room: RoomView; received: number }>();
    for (const host of hosts) {
      host.on("game:start", room => starts.set(room.id, room));
      host.on("game:timeout", room => timeouts.set(room.id, { room, received: Date.now() }));
    }
    await Promise.all(rooms.map(({ player, sessionId }) => ok(player.socket, "game:ready", { sessionId, ready: true })));
    await eventually(() => starts.size === 20);
    for (const started of starts.values()) assert.equal(started.deadline! - started.startedAt!, 60_000);
    await eventually(() => rooms.every(({ player }) => service.campus.playerView(player.id).room?.status === "running"), 4500);

    await Promise.all(rooms.map(({ player }) => service.operate(player.socket, player.id)));
    const alien = await send(winner.player.socket, "game:input", {
      sessionId: rooms.find(room => room !== winner)!.sessionId, seq: 2, action: move("up")
    });
    assert.ok(!alien.ok && alien.code === "wrong-session");
    const winningPlayer = winner.player;
    const viewRoom = () => service.campus.playerView(winningPlayer.id).room!;
    const before = viewRoom();
    await ok(winningPlayer.socket, "game:input", { sessionId: before.id, seq: 1, action: arithmetic((before.scene as Quiz).prompt!) });
    assert.deepEqual(viewRoom().scene, before.scene);
    winningPlayer.socket.disconnect();
    await eventually(() => !service.store.player(winningPlayer.id)!.connected);
    await delay(155);
    winningPlayer.socket = await service.connect();
    const restored = await ok(winningPlayer.socket, "player:reconnect", { token: winningPlayer.token });
    assert.equal(restored.room?.id, before.id);
    assert.equal(restored.room?.deadline, before.deadline);
    assert.equal(restored.room?.seq, before.seq);
    assert.deepEqual(restored.room?.scene, before.scene);
    while (viewRoom()) {
      await delay(85);
      const room = viewRoom();
      await ok(winningPlayer.socket, "game:input", {
        sessionId: room.id, seq: room.seq + 1, action: arithmetic((room.scene as Quiz).prompt!)
      });
    }
    assert.equal(service.store.player(winningPlayer.id)?.total_score, 2);

    const offline = rooms.find(room => room !== winner)!.player;
    offline.socket.disconnect();
    await eventually(() => !service.store.player(offline.id)!.connected);
    await eventually(() => timeouts.size === 19, 65_000);
    const maxDrift = Math.max(...[...timeouts.values()].map(({ room, received }) => {
      assert.equal(room.scene, null);
      assert.ok(received >= room.deadline!);
      return received - room.deadline!;
    }));
    assert.ok(maxDrift < 2000, "timeout broadcast drift " + maxDrift);
    assert.equal(unauthorizedStates, 0);

    for (const row of rooms.filter(room => room !== winner)) {
      const [result] = service.store.resultsForSession(row.sessionId);
      assert.deepEqual([result.playerId, result.outcome, result.duration, result.awarded], [row.player.id, "lose", 60_000, 1]);
      assert.equal(service.store.teamResult(row.sessionId), null);
    }
    for (const [, group] of assignments) {
      for (const queued of group.slice(1)) assert.equal(service.store.player(queued.id)?.total_score, 0);
    }
    assert.equal((await service.attemptStation(winningPlayer.socket, winner.stationId)).ok, false);
    await eventually(() => scoreboards.at(-1)?.players.filter(player => player.completed === 1).length === 20);
    assert.equal(scoreboards.at(-1)!.players.length, 50);
    assert.equal(scoreboards.at(-1)!.teams.length, 10);
    assert.equal(service.campus.adminView().connections.errors, 0);
    console.log("Concurrency: 50 phones, 20 hosts, 20 active rooms. Maximum timeout broadcast drift " + maxDrift + " ms.");
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
