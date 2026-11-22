import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { GAMES, fixedId } from "../packages/shared/catalog";
import type { Leaderboard, RoomView } from "../packages/shared/protocol";
import { harness, ok, send } from "./socket-helper";
import { move } from "./solve";

async function eventually(check: () => boolean, milliseconds = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started >= milliseconds) assert.fail("State did not synchronize within " + milliseconds + " ms");
    await delay(25);
  }
}

test("50 phones and 20 hosts run 13 simultaneous multiplayer matches at real 60-second deadlines", { timeout: 100_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "campus-load-"));
  const service = await harness(join(directory, "load.sqlite"), 0, true);
  try {
    const observer = await service.connect();
    const scoreboards: Leaderboard[] = [];
    observer.on("score:leaderboard", board => scoreboards.push(board));
    let leaked = 0;
    observer.on("game:state", () => leaked++);
    await ok(observer, "campus:watch", null);
    const hosts = await Promise.all(GAMES.map((_game, i) => service.host(fixedId("HOST", i + 1))));
    const players = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      service.player("負載 " + (i + 1), fixedId("TEAM", Math.floor(i / 5) + 1))));
    const initial = service.store.leaderboard();
    assert.equal(initial.players.length, 50);
    assert.ok(initial.players.every(player => player.totalScore === 0 && player.connected));
    assert.ok(initial.teams.every(team => team.members.length === 5));
    assert.equal(service.campus.adminView().connections.hosts, 20);
    assert.equal(service.campus.adminView().connections.players, 50);
    assert.equal(service.io.sockets.sockets.size, 71);
    const extra = await service.connect();
    const rejected = await send(extra, "player:join", { name: "第 51 位" });
    assert.ok(!rejected.ok && rejected.code === "full");
    extra.disconnect();

    const starts = new Map<string, RoomView>();
    const ends = new Map<string, { room: RoomView; at: number }>();
    for (const host of hosts) {
      host.on("game:start", room => starts.set(room.id, room));
      host.on("game:timeout", room => ends.set(room.id, { room, at: Date.now() }));
      host.on("game:finish", room => ends.set(room.id, { room, at: Date.now() }));
    }
    await Promise.all(players.map(player => ok(player.socket, "match:find", null)));
    await eventually(() => players.every(player => service.campus.playerView(player.id).room?.status === "lobby"), 14_000);
    const assignments = new Map<string, { room: RoomView; players: typeof players }>();
    for (const player of players) {
      const room = service.campus.playerView(player.id).room!;
      const entry = assignments.get(room.id) ?? { room, players: [] };
      entry.players.push(player);
      assignments.set(room.id, entry);
    }
    const groups = [...assignments.values()];
    assert.equal(groups.length, 13);
    assert.equal(groups.filter(item => item.players.length === 4).length, 12);
    assert.equal(groups.filter(item => item.players.length === 2).length, 1);
    await Promise.all(groups.flatMap(({ room, players }) =>
      players.map(player => service.joinStation(player.socket, room.stationId))));
    await Promise.all(groups.flatMap(({ room, players }) =>
      players.map(player => ok(player.socket, "game:ready", { sessionId: room.id, ready: true }))));
    await eventually(() => starts.size === 13);
    for (const room of starts.values()) assert.equal(room.deadline! - room.startedAt!, 60_000);
    await eventually(() => players.every(player => service.campus.playerView(player.id).room?.status === "running"), 4500);
    await Promise.all(groups.map(async group => {
      // Teammates can share a cursor or a single quiz prompt. Send their first moves in arrival order.
      for (const player of group.players) {
        await service.operate(player.socket, player.id);
        if (["game-08", "game-09"].includes(group.room.gameId)) await delay(1200);
      }
    }));

    const sample = groups[0].players[0];
    const room = service.campus.playerView(sample.id).room!;
    const alien = await send(sample.socket, "game:input", {
      sessionId: groups[1].room.id, seq: room.seq + 1, action: move("up")
    });
    assert.ok(!alien.ok && alien.code === "wrong-session");
    sample.socket.disconnect();
    await eventually(() => !service.store.player(sample.id)!.connected);
    await delay(160);
    sample.socket = await service.connect();
    const restored = await ok(sample.socket, "player:reconnect", { token: sample.token });
    assert.equal(restored.room?.id, room.id);
    assert.equal(restored.room?.deadline, room.deadline);
    assert.equal(restored.room?.seq, room.seq);
    assert.equal(restored.room?.scene, null);
    assert.equal(restored.room?.match?.panels, undefined);

    await eventually(() => ends.size === 13, 65_000);
    const drift = [...ends.values()].filter(({ room }) => room.reason === "timeout").map(({room, at}) => at - room.deadline!);
    assert.ok(drift.length >= 1);
    assert.ok(drift.every(ms => ms >= 0 && ms < 2000), "timeout drift " + drift.join(", "));
    assert.equal(leaked, 0);
    for (const { room, players } of groups) {
      const results = service.store.resultsForSession(room.id);
      assert.equal(results.length, players.length);
      assert.ok(results.every(result => result.participated && [1,2].includes(result.awarded)));
    }
    await eventually(() => scoreboards.at(-1)?.players.every(player => player.completed === 1) === true);
    assert.equal(scoreboards.at(-1)!.players.length, 50);
    assert.equal(scoreboards.at(-1)!.teams.length, 10);
    assert.equal(service.campus.adminView().connections.errors, 0);
    console.log("Verified 50 controllers, 20 screens, 13 live matches. Maximum timeout drift " + Math.max(...drift) + " ms.");
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
