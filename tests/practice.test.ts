import assert from "node:assert/strict";
import { test } from "node:test";
import { COUNTDOWN_MS, GAME_MS, GAMES } from "../packages/shared/catalog";
import type { PracticeView } from "../packages/shared/practice";
import type { Action, MatchPanel } from "../packages/shared/protocol";
import { ANSWER_COOLDOWN_MS, SCREEN_RECONNECT_MS, STATION_QR_MS } from "../packages/shared/rules";
import { harness, ok, send } from "./socket-helper";

function code(view: PracticeView, seat: "P1" | "P2") {
  const entry = view.entries?.find(item => item.seat === seat);
  assert.ok(entry);
  return new URLSearchParams(new URL(entry.url).hash.slice(1)).get("key")!;
}

test("two private test accounts can switch games and replay on one display without entering competition", async () => {
  const service = await harness();
  try {
    const publicResponse = await fetch(service.origin + "/api/admin/practice");
    assert.equal(publicResponse.status, 401);
    const response = await service.admin("/practice");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const { screenKey } = (await response.json()).data;

    const [screen, first, second, observer] = await Promise.all(Array.from({ length: 4 }, service.connect));
    const campusBefore = await ok(observer, "campus:watch", null);
    let publicUpdates = 0;
    observer.on("practice:state", () => { publicUpdates++; });
    assert.equal((await send(observer, "practice:select", { gameId: "game-01" })).ok, false);
    const { view } = await ok(screen, "practice:join", { role: "screen", credential: screenKey, entryOrigin: service.origin });
    const p1 = code(view, "P1"), p2 = code(view, "P2");
    assert.notEqual(p1, p2);
    const wrongSeat = await send(first, "practice:join", { role: "P2", credential: p1 });
    assert.ok(!wrongSeat.ok && wrongSeat.code === "practice-link");
    const noPhones = await send(screen, "practice:start", null);
    assert.ok(!noPhones.ok && noPhones.code === "not-ready");

    const updated = new Promise<PracticeView>(resolve => screen.once("practice:state", resolve));
    service.step(STATION_QR_MS);
    const entry = await updated;
    const expired = await send(first, "practice:join", { role: "P1", credential: p1 });
    assert.ok(!expired.ok && expired.code === "qr-expired");
    const one = await ok(first, "practice:join", { role: "P1", credential: code(entry, "P1") });
    const onePhone = await send(first, "practice:start", null);
    assert.ok(!onePhone.ok && onePhone.code === "not-ready");
    const two = await ok(second, "practice:join", { role: "P2", credential: code(entry, "P2") });
    assert.notEqual(one.token, two.token);
    assert.equal(two.view.entries, undefined);
    assert.equal((await send(second, "match:find", null)).ok, false);
    const bound = await send(second, "player:join", { name: "誤用測試帳號" });
    assert.ok(!bound.ok && bound.code === "bound");

    for (const game of GAMES) {
      const swapped = await ok(first, "practice:select", { gameId: game.id });
      assert.equal(swapped.gameId, game.id);
    }
    await ok(second, "practice:select", { gameId: "game-10" });
    const countdown = await ok(first, "practice:start", null);
    assert.equal(countdown.round?.status, "countdown");
    assert.equal(countdown.round!.deadline - countdown.round!.startedAt, GAME_MS);
    const cannotSwitch = await send(second, "practice:select", { gameId: "game-02" });
    assert.ok(!cannotSwitch.ok && cannotSwitch.code === "in-progress");
    service.step(COUNTDOWN_MS);
    const phone = await ok(first, "practice:select", { gameId: "game-10" });
    assert.equal(phone.panels, undefined);
    assert.equal(phone.remote?.choices, 4);
    const displayed = await ok(screen, "practice:select", { gameId: "game-10" });
    assert.equal(displayed.panels?.length, 2);
    const input = { sessionId: displayed.round!.id, seq: 1,
      action: { kind: "choice" as const, questionId: phone.remote!.questionId!, index: 0 } };
    const screenInput = await send(screen, "practice:input", input);
    assert.ok(!screenInput.ok && screenInput.code === "wrong-client");
    await ok(first, "practice:input", input);
    await ok(first, "practice:input", input);
    const after = await ok(screen, "practice:select", { gameId: "game-10" });
    assert.deepEqual(after.panels?.map(panel => panel.scene?.kind === "quiz" ? panel.scene.attempted : null), [1, 0]);

    first.disconnect();
    const restored = await service.connect();
    const resumed = await ok(restored, "practice:join", { role: "P1", credential: one.token });
    assert.equal(resumed.view.round?.id, displayed.round?.id);
    assert.equal(resumed.view.seq, 1);
    const nextChoice = { ...input, seq: 2, action: { ...input.action, questionId: resumed.view.remote!.questionId! } };
    assert.equal(resumed.view.remote?.answerAvailableAt, service.time() + ANSWER_COOLDOWN_MS);
    const opponent = await ok(second, "practice:select", { gameId: "game-10" });
    assert.equal(opponent.remote?.answerAvailableAt, undefined);
    await ok(second, "practice:input", { ...input, action: { ...input.action, questionId: opponent.remote!.questionId! } });
    service.step(ANSWER_COOLDOWN_MS - 1);
    const early = await send(restored, "practice:input", nextChoice);
    assert.ok(!early.ok && early.code === "answer-cooldown");
    service.step(1);
    await ok(restored, "practice:input", nextChoice);
    const afterWait = await ok(screen, "practice:select", { gameId: "game-10" });
    assert.deepEqual(afterWait.panels?.map(panel => panel.scene?.kind === "quiz" ? panel.scene.attempted : null), [2, 1]);
    service.step(GAME_MS);
    const ended = await ok(screen, "practice:select", { gameId: "game-10" });
    assert.equal(ended.round?.status, "finished");
    const replay = await ok(second, "practice:start", null);
    assert.notEqual(replay.round?.id, ended.round?.id);
    assert.equal((await ok(second, "practice:stop", null)).round, null);
    assert.equal((await ok(restored, "practice:select", { gameId: "game-03" })).gameId, "game-03");
    assert.equal((await ok(screen, "practice:start", null)).gameId, "game-03");

    const campusAfter = await ok(observer, "campus:watch", null);
    assert.equal(publicUpdates, 0);
    assert.deepEqual(campusAfter.leaderboard, campusBefore.leaderboard);
    assert.deepEqual(campusAfter.stations, campusBefore.stations);
    assert.deepEqual(service.campus.adminView().sessions, []);
  } finally { await service.close(); }
});

test("the last pair of fraction answers settles immediately even when both miss the target", async () => {
  const service = await harness();
  try {
    const [screen, first, second] = await Promise.all(Array.from({ length: 3 }, service.connect));
    const { screenKey } = (await (await service.admin("/practice")).json()).data;
    const { view } = await ok(screen, "practice:join", { role: "screen", credential: screenKey, entryOrigin: service.origin });
    await ok(first, "practice:join", { role: "P1", credential: code(view, "P1") });
    await ok(second, "practice:join", { role: "P2", credential: code(view, "P2") });
    const gameId = "game-13";
    await ok(first, "practice:select", { gameId });
    const started = await ok(first, "practice:start", null);
    service.step(COUNTDOWN_MS);
    const answer = async (client: typeof first, side: number, index: number, correct: boolean) => {
      if (index > 0) service.step(ANSWER_COOLDOWN_MS);
      const current = await ok(screen, "practice:select", { gameId });
      const scene = current.panels![side].scene;
      assert.ok(scene?.kind === "quiz" && scene.prompt);
      const [a, b, c, d] = scene.prompt.text.match(/\d+/g)!.map(Number);
      const option = a * d > c * b ? 0 : a * d === c * b ? 1 : 2;
      await ok(client, "practice:input", { sessionId: started.round!.id, seq: index + 1,
        action: { kind: "choice", questionId: scene.prompt.id, index: correct ? option : (option + 1) % 3 } });
    };
    for (let index = 0; index < 5; index++) await answer(first, 0, index, index === 0);
    const half = await ok(screen, "practice:select", { gameId });
    assert.equal(half.round?.status, "running");
    assert.equal(half.panels?.[0].completion, "exhausted");
    assert.equal((await ok(first, "practice:select", { gameId })).remote?.completion, "exhausted");
    const immediate = [screen, first, second].map(client => new Promise<PracticeView>(resolve => {
      const receive = (update: PracticeView) => {
        if (update.round?.status !== "finished") return;
        client.off("practice:state", receive);
        resolve(update);
      };
      client.on("practice:state", receive);
    }));
    for (let index = 0; index < 5; index++) await answer(second, 1, index, index < 3);

    const finished = await ok(screen, "practice:select", { gameId });
    assert.equal(finished.round?.status, "finished");
    assert.equal(finished.round?.winner, 1);
    assert.equal(finished.round?.reason, "completed");
    assert.ok(service.time() < started.round!.deadline);
    for (const view of await Promise.all(immediate)) assert.deepEqual(view.round, finished.round);
  } finally { await service.close(); }
});

test("the practice screen can resume a round and a longer outage cancels it", async () => {
  const service = await harness();
  try {
    let screen = await service.connect();
    const [first, second] = await Promise.all([service.connect(), service.connect()]);
    const joinScreen = (client: typeof screen) => ok(client, "practice:join", { role: "screen", credential: service.practice.key("screen") });
    const { view } = await joinScreen(screen);
    await ok(first, "practice:join", { role: "P1", credential: code(view, "P1") });
    await ok(second, "practice:join", { role: "P2", credential: code(view, "P2") });
    const gameId = "game-09";
    await ok(screen, "practice:select", { gameId });
    const { round } = await ok(screen, "practice:start", null);
    service.step(COUNTDOWN_MS);
    const latest = await ok(screen, "practice:select", { gameId });
    const disconnect = async () => {
      const paused = new Promise<PracticeView>(resolve => {
        const receive = (update: PracticeView) => {
          if (update.round?.pausedAt == null) return;
          first.off("practice:state", receive);
          resolve(update);
        };
        first.on("practice:state", receive);
      });
      screen.disconnect();
      return paused;
    };
    assert.equal((await disconnect()).round?.pausedAt, service.time());
    service.step(15_000);
    screen = await service.connect();
    const resumed = (await joinScreen(screen)).view;
    assert.equal(resumed.round?.deadline, round!.deadline + 15_000);
    assert.deepEqual(resumed.panels, latest.panels);
    await disconnect();
    service.step(SCREEN_RECONNECT_MS);
    const stopped = (await ok(second, "practice:select", { gameId })).round;
    assert.deepEqual([stopped?.status, stopped?.reason, stopped?.winner], ["finished", "host-offline", null]);
    assert.equal(service.campus.adminView().sessions.length, 0);
  } finally { await service.close(); }
});

test("all 20 practice games start, accept two handsets, display their inputs, and report a terminal result", async () => {
  const service = await harness();
  try {
    const [screen, first, second] = await Promise.all(Array.from({ length: 3 }, service.connect));
    const { screenKey } = (await (await service.admin("/practice")).json()).data;
    const { view } = await ok(screen, "practice:join", { role: "screen", credential: screenKey, entryOrigin: service.origin });
    await ok(first, "practice:join", { role: "P1", credential: code(view, "P1") });
    await ok(second, "practice:join", { role: "P2", credential: code(view, "P2") });
    for (const game of GAMES) {
      await ok(screen, "practice:select", { gameId: game.id });
      const started = await ok(screen, "practice:start", null);
      service.step(COUNTDOWN_MS);
      const display = () => ok(screen, "practice:select", { gameId: game.id });
      const before = await display();
      assert.equal(before.panels?.length, 2, game.id);
      for (const [side, client] of [first, second].entries()) {
        const panel = before.panels![side];
        for (const [index, action] of firstMoves(panel).entries()) {
          await ok(client, "practice:input", { sessionId: started.round!.id, seq: index + 1, action });
          if (game.controls === "runner" || game.controls === "volleyball" || game.controls === "air-hockey") service.step(80);
          const visible = (await display()).panels?.[side];
          if (JSON.stringify(panel) !== JSON.stringify(visible)) break;
        }
        assert.notDeepEqual((await display()).panels?.[side], panel, game.id + " display did not change");
      }
      service.step(GAME_MS);
      const ended = await display();
      assert.equal(ended.round?.status, "finished", game.id);
      assert.ok(ended.round?.reason, game.id);
    }
    assert.deepEqual(service.campus.adminView().sessions, []);
  } finally { await service.close(); }
});

function firstMoves(panel: MatchPanel): Action[] {
  const scene = panel.scene;
  assert.ok(scene);
  if (scene.kind === "quiz") {
    const questionId = scene.prompt!.id;
    return scene.prompt!.options ? [{ kind: "choice", index: 0, questionId }] : [{ kind: "answer", value: "1", questionId }];
  }
  if (panel.cursor !== null) return ["right", "left", "down", "up"].map(direction =>
    ({ kind: "cursor", direction }) as Action);
  if (scene.kind === "volleyball") return [{ kind: "action", action: "hold-right" }, { kind: "action", action: "jump" }];
  if (scene.kind === "air-hockey") return [{ kind: "stick", x: 1, y: 0 }];
  if (scene.kind === "arcade" && scene.theme !== "road") {
    return [{ kind: "action", action: scene.theme === "space" ? "shoot" : "jump" }];
  }
  return ["left", "right", "up", "down"].map(direction => ({ kind: "move", direction }) as Action);
}
