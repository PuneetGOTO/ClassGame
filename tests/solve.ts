import assert from "node:assert/strict";
import { neighbor } from "../packages/game-sdk";
import type { Action, Board, Direction, Prompt } from "../packages/shared/protocol";

export const directions: Direction[] = ["up", "right", "down", "left"];
export const move = (direction: Direction): Action => ({ kind: "move", direction });
export const cell = (index: number): Action => ({ kind: "cell", index });
export const action = (name: "shoot" | "jump" | "duck" | "interact"): Action => ({ kind: "action", action: name });
export function shortest(board: Board, from: number, to: number, passable: (index: number) => boolean = index => board.tiles[index].kind !== "wall") {
  const queue: { index: number; path: Direction[] }[] = [{ index: from, path: [] }];
  const seen = new Set([from]);
  for (const { index, path } of queue) {
    if (index === to) return path;
    for (const direction of directions) {
      const next = neighbor(index, direction, board.width, board.height);
      if (next < 0 || seen.has(next) || !passable(next)) continue;
      seen.add(next);
      queue.push({ index: next, path: [...path, direction] });
    }
  }
  throw new Error("No path " + from + " → " + to);
}
export function solvePipes(board: Board): Action[] {
  const masks = board.tiles.map(tile => tile.mask!);
  const turns: number[] = [];
  const rotate = (value: number) => ((value << 1) | (value >> 3)) & 15;
  function search(i: number): boolean {
    if (i === masks.length) return true;
    const original = masks[i];
    for (let count = 0; count < (board.tiles[i].action ? 4 : 1); count++) {
      const mask = masks[i];
      const suitable = directions.every((direction, dir) => {
        const other = neighbor(i, direction, board.width, board.height);
        const open = Boolean(mask & (1 << dir));
        if (other < 0) return open === ((i === 0 && dir === 3) || (i === masks.length - 1 && dir === 1));
        return other >= i || open === Boolean(masks[other] & (1 << ((dir + 2) % 4)));
      });
      if (suitable && search(i + 1)) { turns[i] = count; return true; }
      masks[i] = rotate(mask);
    }
    masks[i] = original;
    return false;
  }
  assert.equal(search(0), true);
  return turns.flatMap((count, index) => Array.from({ length: count }, () => cell(index)));
}
export function arithmetic(prompt: Prompt): Action {
  const match = /^\(?(\d+) ([+−×÷]) (\d+)\)?(?: \+ (\d+))?$/.exec(prompt.text);
  assert.ok(match, prompt.text);
  const [,left, op, right, extra] = match;
  const a = Number(left), b = Number(right);
  const answer = (op === "+" ? a + b : op === "−" ? a - b : op === "×" ? a * b : a / b) + Number(extra ?? 0);
  assert.ok(Number.isInteger(answer), prompt.text);
  return { kind: "answer", questionId: prompt.id, value: String(answer) };
}

export function solveSokoban(board: Board): Action[] {
  const goals = board.tiles.flatMap((tile, i) => tile.kind.includes("goal") || tile.kind === "box-done" ? [i] : []);
  const player = board.tiles.findIndex(tile => tile.kind.startsWith("player"));
  const initial = board.tiles.flatMap((tile, i) => tile.kind.startsWith("box") ? [i] : []);
  const queue = [{ player, boxes: initial, path: [] as Direction[] }];
  const seen = new Set<string>();
  const step = (position: number, direction: Direction) => neighbor(position, direction, board.width, board.height);
  const floor = (at: number) => at >= 0 && board.tiles[at].kind !== "wall";
  for (const current of queue) {
    const spots = new Map<number, Direction[]>([[current.player, []]]);
    for (const [position, path] of spots) {
      for (const direction of directions) {
        const next = step(position, direction);
        if (floor(next) && !current.boxes.includes(next) && !spots.has(next)) spots.set(next, [...path, direction]);
      }
    }
    const key = current.boxes.toSorted().join(",") + "/" + Math.min(...spots.keys());
    if (seen.has(key)) continue;
    seen.add(key);
    if (current.boxes.every(box => goals.includes(box))) return current.path.map(move);
    for (const [index, box] of current.boxes.entries()) {
      for (const [d, direction] of directions.entries()) {
        const approach = spots.get(step(box, directions[(d + 2) % 4]));
        const next = step(box, direction);
        if (!approach || !floor(next) || current.boxes.includes(next)) continue;
        if (!goals.includes(next) && (["up","down"] as const).some(dir => !floor(step(next, dir)))
          && (["left","right"] as const).some(dir => !floor(step(next, dir)))) continue;
        queue.push({ player: box, boxes: current.boxes.with(index, next), path: current.path.concat(approach, direction) });
      }
    }
  }
  assert.fail("Could not solve Sokoban");
}

