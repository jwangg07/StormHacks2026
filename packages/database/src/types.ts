export type Seat = 'A' | 'B';
export type MatchWinner = Seat | 'DRAW' | null;

export interface PersistedMatch {
  id: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  status: string;
  playerASessionId?: string;
  playerBSessionId?: string;
  winnerSeat?: MatchWinner;
  finalHpA?: number;
  finalHpB?: number;
  matchType: string;
  configVersion: string;
}

export interface CombatEvent {
  time: Date;
  eventId: string;
  matchId: string;
  attackerSeat?: Seat;
  defenderSeat?: Seat;
  hand?: 'left' | 'right';
  eventType: string;
  outcome?: string;
  damage?: number;
  simulationTick?: bigint;
  metadata?: Record<string, unknown>;
}

export interface MovementSample {
  time: Date;
  matchId: string;
  sessionId: string;
  seat: Seat;
  sequence: number;
  head?: { x: number; y: number; z: number };
  leftHand?: { x: number; y: number; z: number };
  rightHand?: { x: number; y: number; z: number };
  body?: { x: number; z: number };
  leftVelocity?: number;
  rightVelocity?: number;
  trackingConfidence?: number;
  guard?: boolean;
  duck?: boolean;
}

export interface MatchPersistence {
  saveMatchStarted(match: PersistedMatch): Promise<void>;
  saveCombatEvents(events: readonly CombatEvent[]): Promise<void>;
  saveMovementSamples(samples: readonly MovementSample[]): Promise<void>;
  saveMatchFinished(match: PersistedMatch): Promise<void>;
  close(): Promise<void>;
}
