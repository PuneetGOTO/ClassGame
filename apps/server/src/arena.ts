import { gameById, type Controls } from "../../../packages/shared/catalog";
import { neighbor, type Frame, type PluginFactory } from "../../../packages/game-sdk";
import type { Action, AnswerStats, MatchEndReason, MatchPanel, RemoteControls, SideCompletion } from "../../../packages/shared/protocol";
import type { Difficulty, MatchMode } from "../../../packages/shared/route";
import { ANSWER_COOLDOWN_MS, STICK_DEADZONE } from "../../../packages/shared/rules";
import { RequestError } from "./store";

interface SideSnapshot {
  side: number; engine: string; cursor: number | null; wonAt: number | null; answerTimes?: [string, number][];
  answerStats?: [string, AnswerStats][];
}
export interface ArenaSeat { id: string; side: number }
interface Side extends Omit<SideSnapshot, "engine" | "answerTimes" | "answerStats"> {
  engine: ReturnType<PluginFactory>; completion?: SideCompletion;
  answerTimes: Map<string, number>; answerStats: Map<string, AnswerStats>;
}
export interface ArenaResult { winner: number | null; reason: MatchEndReason }
const sideKey = (side: number) => "side-" + side;

export const matchMode = (size: number, sideCount?: number): MatchMode =>
  size === 4 && sideCount === 4 ? "ffa4" : size === 4 ? "doubles" : size === 3 ? "free-for-all" : "duel";

export class Arena {
  private readonly sides = new Map<number, Side>();
  private readonly controls: Controls;
  private readonly sharedEngine?: ReturnType<PluginFactory>;
  private readonly sharedSeats = new Map<string, { slot: string; side: number }>();
  readonly timed: boolean;

  constructor(factory: PluginFactory, gameId: string, seed: number, tier: Difficulty, seats: readonly ArenaSeat[], saved?: string | null) {
    const info = gameById.get(gameId)!;
    this.controls = info.controls;
    if (info.sharedArena) {
      const counts = new Map<number, number>();
      for (const { id, side } of seats) {
        const index = counts.get(side) ?? 0;
        counts.set(side, index + 1);
        this.sharedSeats.set(id, { slot: sideKey(side) + "#" + index, side });
      }
      this.sharedEngine = factory({ seed, tier, playerIds: [...this.sharedSeats.values()].map(seat => seat.slot) }, saved);
      this.timed = this.sharedEngine.timed;
      return;
    }
    const snapshots: SideSnapshot[] = saved ? JSON.parse(saved) : [];
    for (const side of new Set(seats.map(seat => seat.side))) {
      const snapshot = snapshots.find(item => item.side === side);
      const engine = factory({ seed, tier, playerIds: [sideKey(side)] }, snapshot?.engine);
      const panel: Side = {
        side, engine, cursor: snapshot?.cursor ?? null, wonAt: snapshot?.wonAt ?? null,
        answerTimes: new Map(snapshot?.answerTimes), answerStats: new Map(snapshot?.answerStats)
      };
      if (panel.wonAt !== null) panel.completion = "cleared";
      else if (snapshot && engine.isComplete()) panel.completion = "exhausted";
      if (!saved && ["cell", "traffic"].includes(this.controls)) {
        const scene = engine.getState(sideKey(side));
        if (scene.kind === "tubes") panel.cursor = 0;
        if (scene.kind === "grid") panel.cursor = scene.tiles.findIndex(tile =>
          tile.action && (this.controls !== "traffic" || tile.kind.includes("tile-car-selected")));
      }
      this.sides.set(side, panel);
    }
    this.timed = [...this.sides.values()].some(side => side.engine.timed);
  }

  start() {
    if (this.sharedEngine) {
      this.sharedEngine.start();
      return;
    }
    for (const side of this.sides.values()) side.engine.start();
  }

  private updateCompletion(side: Side, now: number) {
    if (side.engine.checkWin(sideKey(side.side))) {
      side.wonAt = now;
      side.completion = "cleared";
    } else if (side.engine.isComplete()) {
      side.completion = "exhausted";
    }
    return side.completion !== undefined;
  }

  private moveCursor(side: Side, direction: Extract<Action, { kind: "cursor" }>["direction"]) {
    if (side.cursor == null || side.cursor < 0) return false;
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

  input(sideIndex: number, playerId: string, action: Action, elapsed: number, now: number) {
    if (this.sharedEngine) {
      const seat = this.sharedSeats.get(playerId);
      const accepted = seat?.side === sideIndex && this.sharedEngine.handleInput(seat.slot, action, { elapsed, activePlayers: [seat.slot] });
      const passive = (action.kind === "action" && action.action === "release")
        || (action.kind === "stick" && Math.hypot(action.x, action.y) < STICK_DEADZONE);
      // Releasing a key or returning the stick to center does not count as participation.
      return { changed: accepted, played: accepted && !passive };
    }
    const side = this.sides.get(sideIndex);
    if (!side || side.completion) return { changed: false, played: false };
    const key = sideKey(sideIndex);
    const frame: Frame = { elapsed, activePlayers: [key] };
    if (action.kind === "cursor") {
      const moved = this.moveCursor(side, action.direction);
      return { changed: moved, played: moved };
    }
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
      if (now < (side.answerTimes.get(playerId) ?? 0)) {
        throw new RequestError("請等候 2 秒再作答", "answer-cooldown", 429);
      }
    } else if (action.kind === "action" && action.action === "interact" && side.cursor !== null && side.cursor >= 0) {
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
    if (accepted) {
      if (input.kind === "answer") {
        side.answerTimes.set(playerId, now + ANSWER_COOLDOWN_MS);
        const stats = side.answerStats.get(playerId) ?? { attempted: 0, correct: 0 };
        const scene = side.engine.getState(key);
        stats.attempted++;
        if (scene.kind === "quiz" && scene.feedback === "correct") stats.correct++;
        side.answerStats.set(playerId, stats);
      }
      this.updateCompletion(side, now);
    }
    return { changed: accepted, played: accepted };
  }

  clearHeldControls(playerId?: string) {
    if (playerId === undefined) this.sharedEngine?.clearControls();
    else {
      const slot = this.sharedSeats.get(playerId)?.slot;
      if (slot) this.sharedEngine?.clearControls(slot);
    }
  }

  tick(elapsed: number, now: number, onlineSides: ReadonlySet<number>) {
    if (this.sharedEngine) {
      return this.sharedEngine.tick({ elapsed, activePlayers: [...onlineSides].map(sideKey) });
    }
    let changed = false;
    for (const side of this.sides.values()) {
      if (!side.engine.timed || side.completion) continue;
      const key = sideKey(side.side);
      if (side.engine.tick({ elapsed, activePlayers: onlineSides.has(side.side) ? [key] : [] })) changed = true;
      if (this.updateCompletion(side, now)) changed = true;
    }
    return changed;
  }

  panel(sideIndex: number, sceneVisible = true): MatchPanel {
    if (this.sharedEngine) {
      const key = sideKey(sideIndex);
      return {
        side: sideIndex,
        scene: sceneVisible ? this.sharedEngine.getState(key) : null,
        progress: this.sharedEngine.getProgress(key),
        cursor: null
      };
    }
    const side = this.sides.get(sideIndex);
    const key = sideKey(sideIndex);
    return {
      side: sideIndex,
      scene: sceneVisible ? side?.engine.getState(key) ?? null : null,
      progress: side?.engine.getProgress(key) ?? null,
      cursor: sceneVisible ? side?.cursor ?? null : null,
      completion: side?.completion
    };
  }

  remote(sideIndex: number, playerId: string, clockOffset = 0): RemoteControls {
    if (this.sharedEngine) {
      const slot = this.sharedSeats.get(playerId)?.slot;
      if (!slot || (this.controls !== "bomberman" && this.controls !== "dojo-fighter")) return {};
      const scene = this.sharedEngine.getState(sideKey(sideIndex));
      const players = scene.kind === "bomberman" ? scene.players : scene.kind === "dojo-fighter" ? scene.fighters : [];
      return players.some(player => player.id === slot && !player.alive) ? { eliminated: true } : {};
    }
    const panel = this.panel(sideIndex);
    if (panel.completion) return { completion: panel.completion };
    const prompt = panel.scene?.kind === "quiz" ? panel.scene.prompt : undefined;
    if (!prompt) return {};
    const availableAt = this.sides.get(sideIndex)?.answerTimes.get(playerId);
    return { questionId: prompt.id, choices: prompt.options?.length,
      answerAvailableAt: availableAt === undefined ? undefined : availableAt + clockOffset };
  }

  playerAnswers(sideIndex: number, playerId: string, shared: boolean) {
    if (this.sharedEngine) return {};
    const side = this.sides.get(sideIndex);
    const scene = side?.engine.getState(sideKey(sideIndex));
    if (!side || scene?.kind !== "quiz") return {};
    const sideAnswers = { attempted: scene.attempted, correct: scene.correct };
    if (!shared) return sideAnswers;
    const totalTracked = [...side.answerStats.values()].reduce((sum, stats) => sum + stats.attempted, 0);
    if (totalTracked !== scene.attempted) return { sideAnswers };
    return { sideAnswers, ...(side.answerStats.get(playerId) ?? { attempted: 0, correct: 0 }) };
  }

  result(eligible: ReadonlySet<number>, timeUp = false): ArenaResult | undefined {
    if (this.sharedEngine) {
      const winners = [...eligible].filter(side => this.sharedEngine!.checkWin(sideKey(side)));
      if (winners.length) {
        return { winner: winners.length === 1 ? winners[0] : null, reason: timeUp ? "timeout" : "goal" };
      }
      if (this.sharedEngine.isComplete()) return { winner: null, reason: timeUp ? "timeout" : "goal" };
      if (!timeUp) return;
      const ranked = [...eligible].map(side => {
        const progress = this.panel(side, false).progress;
        return { side, score: progress?.value ?? 0 };
      }).sort((a, b) => b.score - a.score);
      const winner = ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score) ? ranked[0].side : null;
      return { winner, reason: "timeout" };
    }
    const completed = [...this.sides.values()].filter(side => eligible.has(side.side) && side.wonAt !== null);
    completed.sort((first, second) => first.wonAt! - second.wonAt!);
    if (completed.length) {
      const winner = completed[0].wonAt === completed[1]?.wonAt ? null : completed[0].side;
      return { winner, reason: timeUp ? "timeout" : "goal" };
    }
    if (!timeUp && [...this.sides.values()].some(side => !side.completion)) return;
    const ranked = [...eligible].map(side => {
      const progress = this.panel(side, false).progress;
      return { side, ratio: progress ? progress.value / Math.max(1, progress.target) : 0 };
    }).sort((a, b) => b.ratio - a.ratio);
    const winner = ranked.length && (ranked.length === 1 || ranked[0].ratio > ranked[1].ratio) ? ranked[0].side : null;
    return { winner, reason: timeUp ? "timeout" : "completed" };
  }

  finish() {
    if (this.sharedEngine) {
      this.sharedEngine.finish();
      return;
    }
    for (const side of this.sides.values()) side.engine.finish();
  }

  destroy() {
    if (this.sharedEngine) {
      this.sharedEngine.destroy();
      return;
    }
    for (const side of this.sides.values()) side.engine.destroy();
  }

  serialize() {
    if (this.sharedEngine) return this.sharedEngine.serialize();
    return JSON.stringify([...this.sides.values()].map(({ side, engine, cursor, wonAt, answerTimes, answerStats }): SideSnapshot => ({
      side, engine: engine.serialize(), cursor, wonAt,
      ...(answerTimes.size && { answerTimes: [...answerTimes] }),
      ...(answerStats.size && { answerStats: [...answerStats] })
    })));
  }
}
