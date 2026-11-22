import { neighbor, plugin, rng } from "../packages/game-sdk";
import type { GridTile } from "../packages/shared/protocol";
import { tierValue, type Difficulty } from "../packages/shared/route";

export type Theme = "oasis" | "fort" | "dragon";
export interface QuestMap { width: number; height: number; tiles: string[]; spawn: number; exit: number; items: number[]; enemies: number[] }
type Random = ReturnType<typeof rng>;
interface QuestConfig {
  theme: Theme;
  map(seed: number, tier?: Difficulty): QuestMap;
  damage?(step: number, random: Random): number;
  pursue?: (index: number, width: number, height: number, candidates: number[], passable: (at: number) => boolean) => number;
}
interface Avatar { position: number; hp: number; cargo: boolean; done: boolean; tint: number; strikeAt: number }
interface Enemy { position: number; hp: number; max: number }
interface QuestState {
  board: QuestMap; people: Record<string, Avatar>; enemies: Enemy[]; items: number[]; delivered: number;
  hits: number; seed: number; nextMove: number; tier?: Difficulty;
  cargoGoal: number;
}
export const distance = (a: number, b: number, width: number) =>
  Math.abs(a % width - b % width) + Math.abs(Math.floor(a / width) - Math.floor(b / width));

export function quest(config: QuestConfig) {
  const { theme } = config;
  const avatars = (state: QuestState) => Object.values(state.people);
  const killed = (state: QuestState) => state.enemies.filter(enemy => enemy.hp <= 0).length;
  const openExit = (state: QuestState) => killed(state) === state.enemies.length && !state.items.length;
  return plugin<QuestState>({
    init({ seed, playerIds, tier }) {
      const board = config.map(seed, tier);
      const cargoGoal = tier ? tierValue(tier, [1, 2, 3, 4]) : playerIds.length;
      const health = theme === "dragon" ? (tier ? tierValue(tier, [48, 72, 96, 120]) : 100) : 36;
      const people = Object.fromEntries(playerIds.map((id, i) => [id,
        { position: board.spawn, hp: 6, cargo: false, done: false, tint: i, strikeAt: -1000 }]));
      return {
        board, people, items: theme === "oasis" ? board.items.slice(0, cargoGoal) : [...board.items],
        enemies: board.enemies.map(position => ({ position, hp: health, max: health })),
        delivered: 0, hits: 0, seed, nextMove: 5000, tier, cargoGoal
      };
    },
    handleInput(state, id, input, frame) {
      const player = state.people[id];
      if (!player || player.done) return false;
      const { width,height,tiles,exit,spawn } = state.board;
      if (input.kind === "move") {
        const target = neighbor(player.position,input.direction,width,height);
        if (target < 0 || tiles[target] === "wall" || state.enemies.some(enemy => enemy.hp > 0 && enemy.position === target)) return false;
        player.position = target;
        if (theme !== "oasis" && openExit(state) && target === exit) player.done = true;
        return true;
      }
      if (input.kind !== "action" || input.action !== "interact") return false;
      const within = (position: number) => distance(position,player.position,width) <= 1;
      if (theme === "oasis" && player.cargo && within(spawn)) {
        player.cargo = false;
        state.delivered++;
        player.done = !state.tier || state.delivered >= state.cargoGoal;
        return true;
      }
      const item = state.items.findIndex(within);
      if (item >= 0 && !player.cargo) {
        state.items.splice(item,1);
        if (theme === "oasis") player.cargo = true;
        return true;
      }
      const enemy = state.enemies.find(enemy => enemy.hp > 0 && within(enemy.position));
      if (!enemy || frame.elapsed - player.strikeAt < 380) return false;
      player.strikeAt = frame.elapsed;
      const random = rng(state.seed + ++state.hits * 8317);
      enemy.hp = Math.max(0, enemy.hp - (config.damage?.(state.hits, random) ?? 12));
      return true;
    },
    tick: theme !== "oasis" ? (state, frame) => {
      if (frame.elapsed < state.nextMove || openExit(state)) return false;
      const attackers = state.enemies.filter(enemy => enemy.hp > 0);
      const online = frame.activePlayers.map(id => state.people[id]).filter(player => player && !player.done);
      const { width,height,spawn,tiles } = state.board;
      state.nextMove = frame.elapsed + (state.tier ? tierValue(state.tier, [1450, 1300, 1150, 1000]) : 1150);
      for (const enemy of attackers) {
        const victim = online.find(player => distance(enemy.position,player.position,width) <= 1);
        if (victim) {
          victim.hp--;
          if (victim.hp <= 0) {
            victim.hp = 6;
            victim.position = spawn;
          }
          continue;
        }
        const passable = (at: number) => at !== state.board.exit && at !== spawn && tiles[at] !== "wall"
          && !attackers.some(other => other.position === at);
        enemy.position = config.pursue?.(enemy.position,width,height,online.map(player => player.position),passable) ?? enemy.position;
      }
      return true;
    } : undefined,
    getState(state, viewer) {
      const { width,height,tiles,spawn,exit } = state.board;
      return { kind: "grid", width, height, tiles: tiles.map((tile, index): GridTile => {
        const at = avatars(state).filter(player => player.position === index);
        const player = state.people[viewer ?? ""]?.position === index ? state.people[viewer!] : at[0];
        if (player) return { kind: player.done ? "player-done" : "player", tint: player.tint,
          label: at.length > 1 ? String(at.length) : player.cargo ? "◆" : String(player.tint + 1),
          title: (state.tier ? "玩家" : "隊員 " + (player.tint + 1)) + (theme === "oasis" ? "" : " 生命 " + player.hp) };
        const enemy = state.enemies.find(enemy => enemy.hp > 0 && enemy.position === index);
        if (enemy) return { kind: theme === "dragon" ? "dragon" : "enemy", label: String(Math.ceil(enemy.hp / (enemy.max / 4))), title: "敵人生命 " + enemy.hp };
        if (state.items.includes(index)) return { kind: "crystal", label: "◆", title: theme === "oasis" ? "信標" : "晶石" };
        if (index === exit && theme !== "oasis") return openExit(state) ? { kind: "exit" } : { kind: "rock", label: "終" };
        if (index === spawn) return { kind: "camp", label: "營", title: "營地" };
        return { kind: tile };
      }) };
    },
    getProgress(state, viewer) {
      const player = viewer ? state.people[viewer] : undefined;
      if (theme === "oasis") {
        if (state.tier) return { label: "交付信標", target: state.cargoGoal, value: state.delivered };
        if (player) return { label: "拾取並交付信標", target: 2, value: player.done ? 2 : Number(player.cargo) };
        return { label: "交付信標", target: avatars(state).length, value: state.delivered };
      }
      const goals = state.board.items.length + state.enemies.length + avatars(state).length;
      return { label: "道具、敵人與出口", target: goals,
        value: state.board.items.length - state.items.length + killed(state) + avatars(state).filter(person => person.done).length };
    },
    checkWin: state => avatars(state).every(player => player.done)
  });
}

