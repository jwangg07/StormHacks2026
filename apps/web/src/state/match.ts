import type { MatchPhase, Seat } from '@wb/core';

export interface PlayerView {
  seat: Seat;
  name: string;
  health: number;
  guard: boolean;
  duck: boolean;
}

export interface MatchView {
  matchId: string;
  revision: number;
  serverTime: number;
  phase: MatchPhase;
  remainingMs: number;
  players: [PlayerView, PlayerView];
}
