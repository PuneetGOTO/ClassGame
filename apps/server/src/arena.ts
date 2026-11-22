import { gameById, type Controls } from "../../../packages/shared/catalog";
import { neighbor, type Frame, type PluginFactory } from "../../../packages/game-sdk";
import type { Action, MatchPanel, RemoteControls } from "../../../packages/shared/protocol";
import type { Difficulty, MatchMode } from "../../../packages/shared/route";

interface SideSnapshot { side: number; engine: string; cursor: number | null; wonAt: number | null }
interface Side extends Omit<SideSnapshot, "engine"> { engine: ReturnType<PluginFactory> }
const sideKey = (side: number) => "side-" + side;

export const matchMode = (size: number): MatchMode => size === 4 ? "doubles" : size === 3 ? "free-for-all" : "duel";

export class Arena {
  private readonly sides = new Map<number, Side>();
  private readonly controls: Controls;
  readonly timed: boolean;

  constructor(factory: PluginFactory, gameId: string, seed: number, tier: Difficulty, sides: number[], saved?: string | null) {
    this.controls = gameById.get(gameId)!.controls;
    const snapshots: SideSnapshot[] = saved ? JSON.parse(saved) : [];
    for (const side of new Set(sides)) {
      const snapshot = snapshots.find(item => item.side === side);
      const engine = factory({ seed, tier, playerIds: [sideKey(side)] }, snapshot?.engine);
      const panel: Side = { side, engine, cursor: snapshot?.cursor ?? null, wonAt: snapshot?.wonAt ?? null };
      if (!saved && ["cell", "traffic"].includes(this.controls)) {
        const scene = engine.getState(sideKey(side));
        if (scene.kind === "tubes") panel.cursor = 0;
        if (scene.kind === "grid") panel.cursor = scene.tiles.findIndex(tile => tile.action);
      }
      this.sides.set(side, panel);
    }
    this.timed = [...this.sides.values()].some(side => side.engine.timed);
  }

  start() {
    for (const side of this.sides.values()) side.engine.start();
  }

  private moveCursor(side: Side, direction: Extract<Action, { kind: "cursor" }>["direction"]) {
    if (side.cursor == null) return false;
    const scene = side.engine.getState(sideKey(side.side));
    const backward = direction === "left" || direction === "up";
    let next = side.cursor;
    if (scene.kind === "tubes") {
      next = (next + (backward ? -1 : 1) + scene.tubes.length) % scene.tubes.length;
    } else if (scene.kind === "grid" && this.controls === "traffic") {
      const cars = new Map<number, number>();
      scene.tiles.forEach((tile, index) => {
        if (tile.action && tile.tint !== undefined && !cars.has(tile.tint)) cars.set(tile.tint, index);
      });
      const tints = [...cars.keys()];
      const current = tints.indexOf(scene.tiles[side.cursor]?.tint ?? -1);
      if (!tints.length) return false;
      next = cars.get(tints[(current + (backward ? -1 : 1) + tints.length) % tints.length])!;
    } else if (scene.kind === "grid") {
      next = neighbor(next, direction, scene.width, scene.height);
      if (next < 0) return false;
    }
    if (next === side.cursor) return false;
    side.cursor = next;
    return true;
  }

  input(sideIndex: number, action: Action, elapsed: number, now: number) {
    const side = this.sides.get(sideIndex);
    if (!side || side.wonAt !== null) return { changed: false, played: false };
    const key = sideKey(sideIndex);
    const frame: Frame = { elapsed, activePlayers: [key] };
    if (action.kind === "cursor") return { changed: this.moveCursor(side, action.direction), played: false };
    if (action.kind === "cell") return { changed: false, played: false };

    let input: Action = action;
    if (action.kind === "choice" || action.kind === "answer") {
      const scene = side.engine.getState(key);
      const prompt = scene.kind === "quiz" ? scene.prompt : undefined;
      if (!prompt || prompt.id !== action.questionId) return { changed: false, played: false };
      if (action.kind === "choice") {
        const option = prompt.options?.[action.index];
        if (!option) return { changed: false, played: false };
        input = { kind: "answer", questionId: action.questionId, value: option.value };
      } else if (prompt.options) return { changed: false, played: false };
    } else if (action.kind === "action" && action.action === "interact" && side.cursor !== null) {
      input = { kind: "cell", index: side.cursor };
    }
    const before = this.controls === "traffic" && side.cursor != null ? side.engine.getState(key) : null;
    const accepted = side.engine.handleInput(key, input, frame);
    if (accepted && before?.kind === "grid" && input.kind === "move") {
      const previousTint = before.tiles[side.cursor!]?.tint;
      const after = side.engine.getState(key);
      if (after.kind === "grid" && previousTint !== undefined) {
        const index = after.tiles.findIndex(tile => tile.action && tile.tint === previousTint);
        if (index >= 0) side.cursor = index;
      }
    }
    if (accepted && side.engine.checkWin(key)) side.wonAt = now;
    return { changed: accepted, played: accepted };
  }

  tick(elapsed: number, now: number, onlineSides: ReadonlySet<number>) {
    let changed = false;
    for (const side of this.sides.values()) {
      if (!side.engine.timed || side.wonAt !== null) continue;
      const key = sideKey(side.side);
      if (side.engine.tick({ elapsed, activePlayers: onlineSides.has(side.side) ? [key] : [] })) changed = true;
      if (side.engine.checkWin(key)) {
        side.wonAt = now;
        changed = true;
      }
    }
    return changed;
  }

  panel(sideIndex: number, sceneVisible = true): MatchPanel {
    const side = this.sides.get(sideIndex);
    const key = sideKey(sideIndex);
    return {
      side: sideIndex,
      scene: sceneVisible ? side?.engine.getState(key) ?? null : null,
      progress: side?.engine.getProgress(key) ?? null,
      cursor: sceneVisible ? side?.cursor ?? null : null,
      cleared: side?.wonAt != null
    };
  }

  remote(side: number): RemoteControls {
    const panel = this.panel(side);
    const prompt = panel.scene?.kind === "quiz" ? panel.scene.prompt : undefined;
    return prompt ? { questionId: prompt.id, choices: prompt.options?.length } : {};
  }

  completed(eligible: ReadonlySet<number>) {
    const completed = [...this.sides.values()].filter(side => eligible.has(side.side) && side.wonAt !== null);
    completed.sort((first, second) => first.wonAt! - second.wonAt!);
    if (completed.length > 1 && completed[0].wonAt === completed[1].wonAt) return null;
    return completed[0]?.side ?? null;
  }

  winner(eligible: ReadonlySet<number>) {
    const cleared = this.completed(eligible);
    if (cleared !== null) return cleared;
    const ranked = [...eligible].map(side => {
      const progress = this.panel(side, false).progress;
      return { side, ratio: progress ? progress.value / Math.max(1, progress.target) : 0 };
    }).sort((a, b) => b.ratio - a.ratio);
    return ranked.length && (ranked.length === 1 || ranked[0].ratio > ranked[1].ratio) ? ranked[0].side : null;
  }

  finish() {
    for (const side of this.sides.values()) side.engine.finish();
  }

  destroy() {
    for (const side of this.sides.values()) side.engine.destroy();
  }

  serialize() {
    return JSON.stringify([...this.sides.values()].map(({ engine, ...side }) => ({ ...side, engine: engine.serialize() })));
  }
}
