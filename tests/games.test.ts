import assert from "node:assert/strict";
import { test } from "node:test";
import { GAMES } from "../packages/shared/catalog";
import { neighbor, type Engine } from "../packages/game-sdk";
import type { Action, Arcade, Board, Quiz, Tubes } from "../packages/shared/protocol";
import { routeTiers } from "../packages/shared/route";
import { plugins } from "../local-games/registry";
import { expressionEquals24 } from "../local-games/game-11";
import { isPrime } from "../local-games/game-12";
import { action, arithmetic, cell, directions, move, shortest } from "./solve";

const ids = ["a","b","c","d","e"];
const frame = (elapsed: number) => ({ elapsed, activePlayers: ids });
const factory = (number: number, seed = 57, players = [ids[0]]) => {
  const id = GAMES[number - 1].id;
  return plugins.get(id)!({ playerIds: players, seed });
};

test("all 20 active games have seeded, restorable states at four difficulty levels", () => {
  assert.equal(plugins.size, 20);
  assert.equal(GAMES.length, 20);
  assert.ok(GAMES.every(game => game.mode === "solo"));
  for (const game of GAMES) {
    const create = plugins.get(game.id)!;
    const states = routeTiers.map(tier => {
      const context = { seed: 105, playerIds: [ids[0]], tier };
      const engine = create(context);
      engine.start();
      const initial = engine.getState(ids[0]);
      const progress = engine.getProgress(ids[0]);
      assert.ok(progress.target > 0, game.name);
      assert.equal(engine.checkWin(ids[0]), false, game.name);
      assert.equal(engine.handleInput(ids[0], { kind: "answer", value: "99", questionId: 5000 }, frame(1)), false);
      assert.deepEqual(create(context, engine.serialize()).getState(ids[0]), initial);
      assert.ok([117, 241, 392].some(seed => create({ ...context, seed }).serialize() !== engine.serialize()), game.name);
      assert.equal(JSON.stringify(initial).includes('"solution":'), false, game.name);
      engine.tick(frame(60_000));
      assert.equal(engine.checkWin(ids[0]), false, game.name);
      engine.finish();
      engine.destroy();
      return { progress, initial };
    });
    assert.notDeepEqual(states[0], states[3], game.name);
  }
});

test("02 Lights Out generates a nontrivial and solvable board", () => {
  for (const seed of [1,2,105,117]) {
    const game = factory(2, seed);
    const board = game.getState() as Board;
    const state = board.tiles.reduce((mask,tile,i) => tile.kind === "lamp-on" ? mask | (1 << i) : mask, 0);
    assert.notEqual(state,0);
    const changes = board.tiles.map((_,index) =>
      directions.reduce((mask,direction) => {
        const n = neighbor(index,direction,board.width,board.height);
        return n < 0 ? mask : mask | 1 << n;
      },1 << index)
    );
    const solution = Array.from({ length: 2 ** 16 },(_, i) => i).find(pattern =>
      changes.reduce((mask, change,i) => pattern & 1 << i ? mask ^ change : mask, state) === 0)!;
    assert.notEqual(solution, undefined);
    changes.forEach((_,i) => { if (solution & 1 << i) game.handleInput("a",cell(i),frame(0)); });
    assert.ok(game.checkWin("a"));
  }
});
test("04 Rush Hour verifies collision and completes by actually exiting", () => {
  const game = factory(4);
  assert.equal(game.handleInput("a",move("right"),frame(0)),false);
  const path = [cell(29),move("right"),move("right"),cell(9),move("down"),move("down"),cell(11),move("up"),cell(14),
    ...Array.from({ length: 5 },() => move("right"))];
  path.forEach((input,index) => assert.ok(game.handleInput("a",input,frame(index * 100)), "traffic step " + index));
  assert.ok(game.checkWin("a"));
});
for (const tier of [undefined, ...routeTiers]) test("05 Water Sort is solvable at difficulty " + (tier ?? "legacy"), () => {
  const game = plugins.get("game-05")!({ playerIds: ["a"], seed: 57, tier });
  const initial = game.getState() as Tubes;
  const queue = [{ tubes: initial.tubes, path: [] as number[] }];
  const keyFor = (tubes: number[][]) => tubes.map(tube => tube.join("")).sort().join("|");
  const seen = new Set<string>([keyFor(initial.tubes)]);
  let solution: number[] | undefined;
  for (const { tubes,path } of queue) {
    if (tubes.every(tube => !tube.length || (tube.length === 4 && tube.every(color => color === tube[0])))) { solution = path; break; }
    tubes.forEach((source,a) => {
      if (!source.length || (source.length === 4 && source.every(color => color === source[0]))) return;
      tubes.forEach((target,b) => {
        const color = source.at(-1);
        if (a === b || target.length === 4 || (target.length && target.at(-1) !== color)) return;
        const next = tubes.map(tube => tube.slice());
        while (next[a].length && next[a].at(-1) === color && next[b].length < 4) next[b].push(next[a].pop()!);
        const key = keyFor(next);
        if (seen.has(key)) return;
        seen.add(key); queue.push({ tubes: next, path: path.concat(a,b) });
      });
    });
  }
  assert.ok(solution);
  solution.forEach((index,i) => assert.equal(game.handleInput("a",cell(index),frame(i*100)),true));
  assert.ok(game.checkWin("a"));
});
test("06 Maze Muncher collects 12 reachable dots", () => {
  const game = factory(6);
  for (let i = 0; i < 12; i++) {
    const board = game.getState() as Board;
    const start = board.tiles.findIndex(tile => tile.kind === "player");
    const best = board.tiles.flatMap((tile, index) => tile.kind === "dot" ? [shortest(board,start,index)] : [])
      .sort((a,b) => a.length - b.length)[0];
    best.forEach(direction => assert.ok(game.handleInput("a",move(direction),frame(100*i))));
  }
  assert.ok(game.checkWin("a"));
});
test("08 Star Defender's real projectiles can defeat eight moving enemies", () => {
  const game = factory(8);
  let elapsed = 0;
  while (elapsed < 60_000 && !game.checkWin("a")) {
    game.tick(frame(elapsed));
    const actors = (game.getState() as Arcade).actors;
    const pilot = actors.at(-1)!;
    const options = actors.filter(item => item.kind === "invader")
      .sort((a,b) => Math.abs(a.x-pilot.x) - Math.abs(b.x-pilot.x) || b.y-a.y);
    const target = options[0];
    if (target && Math.abs(target.x - pilot.x) > 2.7) {
      game.handleInput("a",move(pilot.x < target.x ? "right" : "left"),frame(elapsed));
      elapsed += 100;
    } else {
      game.handleInput("a",action("shoot"),frame(elapsed));
      elapsed += 800;
    }
  }
  assert.ok(game.checkWin("a"), "star defender did not complete by " + elapsed);
});
test("09 Dino Run permits eight consecutive obstacles using both touch actions", () => {
  const game = factory(9);
  const used = new Set<string>();
  for (let elapsed = 0; elapsed < 60_000 && !game.checkWin("a"); elapsed += 40) {
    game.tick(frame(elapsed));
    const obstacle = (game.getState() as Arcade).actors.find(item => ["cactus","bird"].includes(item.kind) && item.x > 36 && item.x <= 37.4);
    if (obstacle) {
      const control = obstacle.kind === "bird" ? "duck" : "jump";
      used.add(control);
      assert.ok(game.handleInput("a",action(control),frame(elapsed)));
    }
  }
  assert.ok(game.checkWin("a"));
  assert.deepEqual([...used].sort(),["duck","jump"]);
});

test("09 Dino Run keeps a clear reached during a delayed update", () => {
  const game = factory(9);
  const state = JSON.parse(game.serialize());
  state.streak = state.target - 1;
  state.obstacles = [
    { kind: "cactus", x: 10, y: 67, width: 6, height: 17, passed: false },
    { kind: "cactus", x: 92, y: 67, width: 6, height: 17, passed: false }
  ];
  const resumed = plugins.get("game-09")!({ seed: 57, playerIds: ["a"] }, JSON.stringify(state));
  resumed.tick(frame(3000));
  assert.equal(resumed.checkWin("a"), true);
  assert.equal(resumed.getProgress().value, resumed.getProgress().target);
});
test("11 Game 24 validates exact arithmetic and consumes every operand once", () => {
  assert.equal(expressionEquals24("6÷(1−3÷4)", [6,1,3,4]), true);
  assert.equal(expressionEquals24("6/(1-3/4)+0", [6,1,3,4]), false);
  assert.equal(expressionEquals24("24", [6,1,3,4]), false);
  assert.equal(expressionEquals24("4/(3-3)+1", [4,3,3,1]), false);
  const game = factory(11);
  const state = JSON.parse(game.serialize()).byPlayer.a;
  assert.equal(game.handleInput("a",{ kind: "answer", questionId: 1, value: "24" },frame(1)),true);
  assert.equal((game.getState("a") as Quiz).feedback,"incorrect");
  for (const q of state.questions) {
    assert.equal(game.handleInput("a",{ kind: "answer", questionId: q.id, value: q.solution },frame(100)),true);
  }
  assert.ok(game.checkWin("a"));
});
test("12 Prime Check requires ten answers and at least eight correct", () => {
  const game = factory(12);
  for (let i = 0; i < 10; i++) {
    const q = (game.getState("a") as Quiz).prompt!;
    const actual = isPrime(Number(q.text.split(" ")[0]));
    assert.ok(game.handleInput("a",{ kind: "answer", questionId: q.id, value: (i > 1 ? actual : !actual) ? "yes" : "no" },frame(i)));
    assert.equal(game.checkWin("a"),i === 9);
  }
});
test("13 Fraction Compare recognizes exact equality only as equality", () => {
  const game = factory(13);
  const first = (game.getState("a") as Quiz).prompt!;
  game.handleInput("a",{ kind: "answer", questionId: first.id, value: "left" },frame(1));
  assert.equal((game.getState("a") as Quiz).feedback,"incorrect");
  for (let i = 1; i < 8; i++) {
    const q = (game.getState("a") as Quiz).prompt!;
    const [a,b,c,d] = q.text.match(/\d+/g)!.map(Number);
    game.handleInput("a",{ kind: "answer", questionId: q.id, value: a*d > c*b ? "left" : a*d < c*b ? "right" : "equal" },frame(i));
  }
  assert.ok(game.checkWin("a"));
});

function questControl(game: Engine) {
  let elapsed = 0;
  const state = () => JSON.parse(game.serialize()) as {
    items: number[]; board: { spawn: number; exit: number; width: number };
    people: Record<string,{ position: number; done: boolean }>; enemies: { position: number; hp: number }[];
  };
  const send = (id: string, action: Action) => {
    elapsed += action.kind === "action" ? 400 : 100;
    assert.ok(elapsed < 60_000);
    assert.ok(game.handleInput(id,action,frame(elapsed)));
  };
  const go = (id: string, to: number) => {
    const data = state();
    const board = game.getState(id) as Board;
    const path = shortest(board,data.people[id].position,to,index =>
      !["wall","enemy","dragon"].includes(board.tiles[index].kind));
    path.forEach(direction => send(id,move(direction)));
  };
  const approach = (id: string, target: number) => {
    const board = game.getState(id) as Board;
    const adjacent = directions.map(direction => neighbor(target,direction,board.width,board.height))
      .find(position => position >= 0 && !["wall","enemy","dragon"].includes(board.tiles[position].kind))!;
    go(id,adjacent);
  };
  return { state,send,go,approach };
}
test("15 Oasis shares items and counts each teammate delivering once", () => {
  const game = factory(15,813,ids);
  const { state,send,go } = questControl(game);
  for (const id of ids) {
    go(id,state().items[0]);
    send(id,action("interact"));
    go(id,state().board.spawn);
    send(id,action("interact"));
  }
  assert.equal(game.getProgress().value,5);
  assert.ok(ids.every(id => game.checkWin(id)));
});
test("16 BrowserQuest resolves authoritative combat, items and every player's arrival", () => {
  const game = factory(16,703,ids);
  const { state,send,go,approach } = questControl(game);
  for (const [i,enemy] of state().enemies.entries()) {
    approach(ids[i],enemy.position);
    while (state().enemies[i].hp > 0) send(ids[i],action("interact"));
  }
  for (const [i,item] of state().items.entries()) {
    go(ids[i],item);
    send(ids[i],action("interact"));
  }
  for (const id of ids) go(id,state().board.exit);
  assert.ok(game.isComplete());
  assert.ok(ids.every(id => game.checkWin(id)));
});
test("20 Math Breakout shares bricks and requires individual contributions", () => {
  const game = factory(20,87,ids);
  for (let i = 0; i < 15; i++) {
    const q = (game.getState(ids[0]) as Quiz).prompt!;
    game.handleInput(ids[0],arithmetic(q),frame(i));
  }
  assert.equal((game.getState(ids[4]) as Quiz).bricks,0);
  assert.equal(game.checkWin(ids[4]),false);
  for (const id of ids.slice(1)) game.handleInput(id,arithmetic((game.getState(id) as Quiz).prompt!),frame(2400));
  assert.ok(game.isComplete());
});

