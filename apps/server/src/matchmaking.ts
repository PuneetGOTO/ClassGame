import { randomInt } from "node:crypto";
import { routeTier } from "../../../packages/shared/route";
import { MATCH_GROUP_WAIT_MS, MATCH_WAIT_MS, MAX_MATCH_PLAYERS, MIN_MATCH_PLAYERS } from "../../../packages/shared/rules";
import type { Floor } from "../../../packages/shared/floors";

export interface Candidate {
  id: string; step: number; queuedAt: number; games: ReadonlySet<string>; lastFloor: Floor | null;
}
interface RoomChoice { id: string; gameId: string; floor: Floor }
export interface MatchChoice { stationId: string; players: Candidate[] }

export function selectMatch(waiting: Candidate[], rooms: RoomChoice[], now: number): MatchChoice | undefined {
  for (const first of waiting) {
    const wait = now - first.queuedAt;
    if (wait < MATCH_GROUP_WAIT_MS) continue;
    const candidates = rooms.flatMap(room => {
      if (first.games.has(room.gameId)) return [];
      const compatible = waiting.filter(player => player !== first && !player.games.has(room.gameId));
      compatible.sort((a, b) => Math.abs(a.step - first.step) - Math.abs(b.step - first.step) || a.queuedAt - b.queuedAt);
      const sameTier = compatible.filter(player => routeTier(player.step) === routeTier(first.step));
      const others = wait >= MATCH_WAIT_MS ? compatible : sameTier;
      // Leave at least two players together when four seats would leave one alone.
      const size = waiting.length % MAX_MATCH_PLAYERS === 1 && waiting.length >= 5 ? 3 : MAX_MATCH_PLAYERS;
      const players = [first, ...others.slice(0, size - 1)];
      if (players.length < (wait >= MATCH_WAIT_MS ? MIN_MATCH_PLAYERS : size)) return [];
      const spread = Math.max(...players.map(player => player.step)) - Math.min(...players.map(player => player.step));
      const floorChanges = players.filter(player => player.lastFloor && player.lastFloor !== room.floor).length;
      return [{ stationId: room.id, players, spread, floorChanges }];
    }).sort((a, b) => b.players.length - a.players.length || a.spread - b.spread || a.floorChanges - b.floorChanges);
    if (!candidates.length) continue;
    const preferred = candidates[0];
    const equal = candidates.filter(item => item.players.length === preferred.players.length
      && item.spread === preferred.spread && item.floorChanges === preferred.floorChanges);
    return equal[randomInt(equal.length)];
  }
}
