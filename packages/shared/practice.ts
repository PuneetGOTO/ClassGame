import type { MatchEndReason, MatchPanel, RemoteControls } from "./protocol";

export const practiceSeats = ["P1", "P2"] as const;
export type PracticeSeat = typeof practiceSeats[number];
export type PracticeRole = PracticeSeat | "screen";
export const practiceNames: Record<PracticeSeat, string> = { P1: "測試帳號 1", P2: "測試帳號 2" };

export interface PracticeView {
  role: PracticeRole;
  gameId: string;
  screenOnline: boolean;
  seats: Record<PracticeSeat, boolean>;
  round: {
    id: string;
    status: "countdown" | "running" | "finished";
    startedAt: number;
    deadline: number;
    winner: number | null;
    reason: MatchEndReason | "host-offline" | null;
    pausedAt?: number;
  } | null;
  panels?: MatchPanel[];
  entries?: { seat: PracticeSeat; url: string }[];
  remote?: RemoteControls;
  seq: number;
}
