import type {
  CombatEvent,
  MovementSample,
  PersistedMatch,
  Seat as PersistenceSeat,
} from '@wb/database';
import { AsyncPersistenceWriter, MovementSampler } from '@wb/database';
import type { GameInput, Hand, MatchState, Seat } from '@wb/core';

export interface MatchIdentity {
  playerASessionId: string;
  playerBSessionId: string;
  matchType: string;
}

export interface ResolvedCombatEvent {
  eventId: string;
  matchId: string;
  attackerSeat: Seat;
  defenderSeat: Seat;
  hand: Hand;
  outcome: 'HIT' | 'BLOCK' | 'MISS';
  damage: number;
  resolvedAt: number;
  simulationTick: bigint;
}

function persistedMatch(state: MatchState, identity: MatchIdentity): PersistedMatch {
  return {
    id: state.id,
    createdAt: new Date(state.createdAt),
    startedAt: state.startedAt === undefined ? undefined : new Date(state.startedAt),
    endedAt: state.finishedAt === undefined ? undefined : new Date(state.finishedAt),
    status: state.state,
    playerASessionId: identity.playerASessionId,
    playerBSessionId: identity.playerBSessionId,
    winnerSeat: state.result?.draw ? 'DRAW' : (state.result?.winnerSeat ?? null),
    finalHpA: state.state === 'FINISHED' ? state.players.A.hp : undefined,
    finalHpB: state.state === 'FINISHED' ? state.players.B.hp : undefined,
    matchType: identity.matchType,
    configVersion: 'p0',
  };
}

function velocityMagnitude(hand: GameInput['leftHand']): number | undefined {
  const velocity = hand.velocity;
  return velocity && Math.hypot(velocity.x, velocity.y, velocity.z);
}

/** Synchronous enqueue-only boundary between authoritative gameplay and optional persistence. */
export class MatchPersistenceService {
  private readonly started = new Set<string>();
  private readonly finished = new Set<string>();

  constructor(
    private readonly writer: AsyncPersistenceWriter,
    private readonly movementSampler = new MovementSampler(5),
  ) {}

  recordStarted(state: MatchState, identity: MatchIdentity): boolean {
    if (this.started.has(state.id)) return false;
    const accepted = this.writer.enqueueMatchStarted(persistedMatch(state, identity));
    if (accepted) this.started.add(state.id);
    return accepted;
  }

  recordCombat(resolved: ResolvedCombatEvent): boolean {
    const event: CombatEvent = {
      time: new Date(resolved.resolvedAt),
      eventId: resolved.eventId,
      matchId: resolved.matchId,
      attackerSeat: resolved.attackerSeat as PersistenceSeat,
      defenderSeat: resolved.defenderSeat as PersistenceSeat,
      hand: resolved.hand,
      eventType: 'ATTACK_RESOLVED',
      outcome: resolved.outcome,
      damage: resolved.damage,
      simulationTick: resolved.simulationTick,
    };
    return this.writer.enqueueCombatEvent(event);
  }

  recordMovement(
    state: MatchState,
    sessionId: string,
    seat: Seat,
    input: GameInput,
    receivedAt: number,
  ): boolean {
    const sample: MovementSample = {
      time: new Date(receivedAt),
      matchId: state.id,
      sessionId,
      seat: seat as PersistenceSeat,
      sequence: input.sequence,
      head: input.head,
      leftHand: input.leftHand,
      rightHand: input.rightHand,
      body: { x: input.body.x, z: input.body.z },
      leftVelocity: velocityMagnitude(input.leftHand),
      rightVelocity: velocityMagnitude(input.rightHand),
      guard: input.guard,
      duck: input.duck,
    };
    return this.movementSampler.shouldKeep(sample) && this.writer.enqueueMovementSample(sample);
  }

  recordFinished(state: MatchState, identity: MatchIdentity): boolean {
    if (this.finished.has(state.id)) return false;
    const accepted = this.writer.enqueueMatchFinished(persistedMatch(state, identity));
    if (accepted) {
      this.finished.add(state.id);
      this.movementSampler.clearMatch(state.id);
    }
    return accepted;
  }
}
