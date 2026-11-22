import assert from "node:assert/strict";
import test from "node:test";
import { Arena } from "../apps/server/src/arena";
import { plugins } from "../local-games/registry";
import { DOJO_FIGHTER_ID, GAME_MS } from "../packages/shared/catalog";
import type { DojoFighterScene } from "../packages/shared/protocol";

const dojoFactory = plugins.get(DOJO_FIGHTER_ID)!;

test("Dojo Fighter supports 1v1 movement, turning, grounded jump, slash hit, clash and serialization", () => {
  const seats = [{ id: "p1", side: 0 }, { id: "p2", side: 1 }];
  const arena = new Arena(dojoFactory, DOJO_FIGHTER_ID, 42, 1, seats);
  arena.start();

  // 无效输入绝不推进物理时钟
  const snapshot = arena.serialize();
  assert.equal(arena.input(0, "p1", { kind: "answer", questionId: 1, value: "99" }, 400, 400).changed, false);
  assert.equal(arena.serialize(), snapshot);

  // p1 向左转身、起跳，再空中再次按跳跃不可无限二段跳
  arena.input(0, "p1", { kind: "action", action: "hold-left" }, 50, 50);
  arena.tick(180, 180, new Set([0, 1]));
  const turned = arena.panel(0).scene as DojoFighterScene;
  assert.equal(turned.fighters[0].facing, -1);

  arena.input(0, "p1", { kind: "action", action: "jump" }, 200, 200);
  arena.tick(320, 320, new Set([0, 1]));
  const midAir = arena.panel(0).scene as DojoFighterScene;
  assert.ok(midAir.fighters[0].y < midAir.groundY);
  const vyBefore = midAir.fighters[0].vy;
  arena.input(0, "p1", { kind: "action", action: "jump" }, 340, 340);
  arena.tick(380, 380, new Set([0, 1]));
  const midAirAfter = arena.panel(0).scene as DojoFighterScene;
  assert.ok(midAirAfter.fighters[0].vy > vyBefore, "空中应继续受重力下落，不可无限浮空连跳");

  // 序列化注入：贴脸拼刀（Clash）双方均免伤弹开
  const rawClash = JSON.parse(arena.serialize());
  rawClash.fighters[0].x = 540; rawClash.fighters[0].y = 492; rawClash.fighters[0].vy = 0; rawClash.fighters[0].facing = 1;
  rawClash.fighters[1].x = 640; rawClash.fighters[1].y = 492; rawClash.fighters[1].vy = 0; rawClash.fighters[1].facing = -1;
  const clashArena = new Arena(dojoFactory, DOJO_FIGHTER_ID, 42, 1, seats, JSON.stringify(rawClash));
  clashArena.clearHeldControls();
  clashArena.input(0, "p1", { kind: "action", action: "attack" }, 1000, 1000);
  clashArena.input(1, "p2", { kind: "action", action: "attack" }, 1000, 1000);
  clashArena.tick(1120, 1120, new Set([0, 1]));
  const clashScene = clashArena.panel(0).scene as DojoFighterScene;
  assert.equal(clashScene.spark?.kind, "clash");
  assert.deepEqual(clashScene.teamHp, [100, 100]);

  // 单方面挥刀命中：基础伤害 18 血
  const rawHit = JSON.parse(arena.serialize());
  rawHit.fighters[0].x = 540; rawHit.fighters[0].y = 492; rawHit.fighters[0].vy = 0; rawHit.fighters[0].facing = 1;
  rawHit.fighters[1].x = 630; rawHit.fighters[1].y = 492; rawHit.fighters[1].vy = 0; rawHit.fighters[1].facing = -1;
  const hitArena = new Arena(dojoFactory, DOJO_FIGHTER_ID, 42, 1, seats, JSON.stringify(rawHit));
  hitArena.clearHeldControls();
  hitArena.input(0, "p1", { kind: "action", action: "attack" }, 1000, 1000);
  hitArena.tick(1120, 1120, new Set([0, 1]));
  const hitScene = hitArena.panel(0).scene as DojoFighterScene;
  assert.equal(hitScene.teamHp[1], 82);
  assert.equal(hitScene.spark?.damage, 18);
});

test("Dojo Fighter 2v2 keeps teammates immune to friendly fire and wins immediately upon team wipe", () => {
  const seats = [
    { id: "b1", side: 0 },
    { id: "r1", side: 1 },
    { id: "b2", side: 0 },
    { id: "r2", side: 1 }
  ];
  const arena = new Arena(dojoFactory, DOJO_FIGHTER_ID, 88, 2, seats);
  arena.start();

  const initial = arena.panel(0).scene as DojoFighterScene;
  assert.equal(initial.fighters.length, 4);
  assert.deepEqual(initial.teamMaxHp, [200, 200]);

  // 把蓝队 b1、b2 贴身放在左侧，红队 r1、r2 放在右侧残血（10 HP）
  const raw = JSON.parse(arena.serialize());
  raw.fighters[0].x = 400; raw.fighters[0].facing = 1; // b1
  raw.fighters[1].x = 460; raw.fighters[1].facing = 1; // b2 队友站在 b1 刀锋正前方
  raw.fighters[2].x = 500; raw.fighters[2].hp = 10;    // r1 残血
  raw.fighters[3].x = 520; raw.fighters[3].hp = 10;    // r2 残血
  const match = new Arena(dojoFactory, DOJO_FIGHTER_ID, 88, 2, seats, JSON.stringify(raw));

  match.input(0, "b1", { kind: "action", action: "attack" }, 200, 200);
  match.tick(360, 360, new Set([0, 1]));
  const after = match.panel(0).scene as DojoFighterScene;
  assert.equal(after.fighters[1].hp, 100, "2v2 队友必须严格免伤");
  assert.equal(after.teamHp[1], 0, "红队两员同时被清血团灭");
  assert.equal(after.finished, true);
  assert.deepEqual(match.result(new Set([0, 1])), { winner: 0, reason: "goal" });
});

test("Dojo Fighter activates 40s double-damage overdrive and 55s tied sudden-death one-hit KO within 60s", () => {
  const seats = [{ id: "p1", side: 0 }, { id: "p2", side: 1 }];
  const arena = new Arena(dojoFactory, DOJO_FIGHTER_ID, 105, 3, seats);
  arena.start();

  // 第 40 秒进入双倍伤害（每刀 36 伤）
  arena.tick(40_500, 40_500, new Set([0, 1]));
  const over = arena.panel(0).scene as DojoFighterScene;
  assert.equal(over.phase, "overdrive");

  const rawOver = JSON.parse(arena.serialize());
  rawOver.fighters[0].x = 540; rawOver.fighters[0].facing = 1;
  rawOver.fighters[1].x = 620; rawOver.fighters[1].facing = -1;
  const overArena = new Arena(dojoFactory, DOJO_FIGHTER_ID, 105, 3, seats, JSON.stringify(rawOver));
  overArena.input(0, "p1", { kind: "action", action: "attack" }, 40_600, 40_600);
  overArena.tick(40_760, 40_760, new Set([0, 1]));
  const afterOver = overArena.panel(0).scene as DojoFighterScene;
  assert.equal(afterOver.teamHp[1], 64, "第 40 秒后伤害应翻倍为 36");

  // 满 60 秒按总血量判胜
  overArena.tick(GAME_MS, GAME_MS, new Set([0, 1]));
  assert.deepEqual(overArena.result(new Set([0, 1]), true), { winner: 0, reason: "timeout" });

  // 第 55 秒平血触发 5 秒「一击必杀」突然死亡：满血对手一刀直接 KO
  const sdArena = new Arena(dojoFactory, DOJO_FIGHTER_ID, 105, 4, seats);
  sdArena.start();
  sdArena.tick(55_200, 55_200, new Set([0, 1]));
  const sdBefore = sdArena.panel(0).scene as DojoFighterScene;
  assert.equal(sdBefore.phase, "sudden-death");

  const rawSd = JSON.parse(sdArena.serialize());
  rawSd.fighters[0].x = 540; rawSd.fighters[0].facing = 1;
  rawSd.fighters[1].x = 620; rawSd.fighters[1].facing = -1;
  const sdMatch = new Arena(dojoFactory, DOJO_FIGHTER_ID, 105, 4, seats, JSON.stringify(rawSd));
  sdMatch.input(0, "p1", { kind: "action", action: "attack" }, 55_300, 55_300);
  sdMatch.tick(55_460, 55_460, new Set([0, 1]));
  assert.deepEqual(sdMatch.result(new Set([0, 1])), { winner: 0, reason: "goal" });
});
