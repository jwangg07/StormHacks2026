import type { MatchPhase, Seat } from '@wb/core';

export interface MatchState {
  id: string;
  phase: MatchPhase;
  startedAt?: number;
  remainingMs: number;
  health: Record<Seat, number>;
  revision: number;
}
