import {
  clamp,
  matchConfig,
  otherSeat,
  resolveAttack,
  type CombatOutcome,
  type FighterState,
  type GameInput,
  type Hand,
  type MatchResult,
  type MatchState,
  type PlayerMatchStats,
  type ScheduledAttack,
  type Seat,
} from '@wb/core';
import { randomUUID } from 'node:crypto';
import type { MatchIdentity, MatchPersistenceService } from '../services/matchPersistence';

function fighter(): FighterState {
  return {
    hp: matchConfig.maxHealth,
    guard: false,
    duck: false,
    tracking: 'VALID',
    headOffset: { x: 0, y: 0, z: 0 },
    leftHand: { x: 0, y: 0, z: 0 },
    rightHand: { x: 0, y: 0, z: 0 },
    bodyPosition: { x: 0, z: 0 },
    lastAcceptedSequence: -1,
    lastPunchAt: -Infinity,
  };
}

function stats(): PlayerMatchStats {
  return {
    attempts: 0,
    leftAttempts: 0,
    rightAttempts: 0,
    cleanHits: 0,
    blocks: 0,
    misses: 0,
    damageDealt: 0,
    damageReceived: 0,
    successfulDucks: 0,
    trackingPauseMs: 0,
  };
}

export interface MatchRuntimeOptions extends MatchIdentity {
  id?: string;
  roomId: string;
  createdAt?: number;
}

export interface ResolvedAttack {
  attack: ScheduledAttack;
  outcome: CombatOutcome;
  damage: number;
}

/**
 * Minimal synchronous authoritative lifecycle. Persistence calls only enqueue and
 * never return promises, so database latency cannot enter gameplay execution.
 */
export class AuthoritativeMatch {
  readonly state: MatchState;
  private readonly identity: MatchIdentity;
  private simulationTick = 0n;
  private pausedAt?: number;
  private pausedSeats: Seat[] = [];

  constructor(
    options: MatchRuntimeOptions,
    private readonly persistence: MatchPersistenceService,
  ) {
    this.identity = {
      playerASessionId: options.playerASessionId,
      playerBSessionId: options.playerBSessionId,
      matchType: options.matchType,
    };
    this.state = {
      id: options.id ?? randomUUID(),
      roomId: options.roomId,
      state: 'COUNTDOWN',
      revision: 0,
      createdAt: options.createdAt ?? Date.now(),
      remainingTimeMs: matchConfig.roundMs,
      players: { A: fighter(), B: fighter() },
      attacks: [],
      stats: { A: stats(), B: stats() },
    };
  }

  start(now = Date.now()): boolean {
    if (this.state.state !== 'COUNTDOWN') return false;
    this.state.state = 'ACTIVE';
    this.state.startedAt = now;
    this.state.revision++;
    this.persistence.recordStarted(this.state, this.identity);
    return true;
  }

  applyInput(seat: Seat, sessionId: string, input: GameInput, now = Date.now()): boolean {
    if (
      (this.state.state !== 'ACTIVE' && this.state.state !== 'PAUSED') ||
      input.matchId !== this.state.id
    )
      return false;
    const player = this.state.players[seat];
    if (input.sequence <= player.lastAcceptedSequence) return false;
    player.lastAcceptedSequence = input.sequence;
    player.tracking = input.tracking;
    player.guard = input.guard;
    player.duck = input.duck;
    player.dodge = input.tracking === 'VALID' && !input.duck ? input.dodge : undefined;
    player.headOffset = input.head;
    player.leftHand = input.leftHand;
    player.rightHand = input.rightHand;
    player.bodyPosition = { x: input.body.x, z: input.body.z };
    this.state.revision++;
    this.persistence.recordMovement(this.state, sessionId, seat, input, now);
    return true;
  }

  syncTracking(now = Date.now()): 'PAUSED' | 'RESUMED' | null {
    const invalid = (['A', 'B'] as const).filter(
      (seat) => this.state.players[seat].tracking !== 'VALID',
    );
    if (this.state.state === 'ACTIVE' && invalid.length > 0) {
      this.state.state = 'PAUSED';
      this.pausedAt = now;
      this.pausedSeats = [...invalid];
      this.state.attacks = [];
      this.state.revision++;
      return 'PAUSED';
    }
    if (this.state.state === 'PAUSED' && invalid.length === 0) {
      const pauseDuration = Math.max(0, now - (this.pausedAt ?? now));
      if (this.state.startedAt !== undefined) this.state.startedAt += pauseDuration;
      for (const seat of this.pausedSeats) this.state.stats[seat].trackingPauseMs += pauseDuration;
      this.pausedAt = undefined;
      this.pausedSeats = [];
      this.state.state = 'ACTIVE';
      this.state.revision++;
      return 'RESUMED';
    }
    return null;
  }

  requestPunch(attackerSeat: Seat, hand: Hand, now = Date.now()): ScheduledAttack | null {
    if (this.state.state !== 'ACTIVE') return null;
    const attacker = this.state.players[attackerSeat];
    const defender = this.state.players[otherSeat(attackerSeat)];
    if (attacker.tracking !== 'VALID' || defender.tracking !== 'VALID') return null;
    if (now - attacker.lastPunchAt < matchConfig.attackCooldownMs) return null;

    attacker.lastPunchAt = now;
    attacker.guard = false;
    attacker.duck = false;
    const attack: ScheduledAttack = {
      id: randomUUID(),
      attackerSeat,
      defenderSeat: otherSeat(attackerSeat),
      hand,
      requestedAt: now,
      windupEndsAt: now + matchConfig.punchWindupMs,
      activeEndsAt: now + matchConfig.punchWindupMs + matchConfig.punchActiveMs,
      recoveryEndsAt:
        now + matchConfig.punchWindupMs + matchConfig.punchActiveMs + matchConfig.punchRecoveryMs,
      resolved: false,
    };
    this.state.attacks.push(attack);
    this.state.revision++;
    return attack;
  }

  tick(now = Date.now()): ResolvedAttack[] {
    if (this.state.state !== 'ACTIVE') return [];
    if (this.state.startedAt !== undefined) {
      this.state.remainingTimeMs = Math.max(0, matchConfig.roundMs - (now - this.state.startedAt));
    }

    const resolved: ResolvedAttack[] = [];
    for (const attack of this.state.attacks) {
      if (attack.resolved || now < attack.windupEndsAt) continue;
      attack.resolved = true;
      const before = this.state.players[attack.defenderSeat].hp;
      const outcome = this.resolvePunch(attack.attackerSeat, attack.hand, now);
      if (outcome) {
        resolved.push({
          attack,
          outcome,
          damage: before - this.state.players[attack.defenderSeat].hp,
        });
      }
    }
    this.state.attacks = this.state.attacks.filter((attack) => now < attack.recoveryEndsAt);

    if (this.state.state === 'ACTIVE' && this.state.remainingTimeMs === 0) {
      const hpA = this.state.players.A.hp;
      const hpB = this.state.players.B.hp;
      const winnerSeat =
        hpA !== hpB
          ? hpA > hpB
            ? 'A'
            : 'B'
          : this.state.stats.A.cleanHits !== this.state.stats.B.cleanHits
            ? this.state.stats.A.cleanHits > this.state.stats.B.cleanHits
              ? 'A'
              : 'B'
            : this.state.stats.A.attempts >= this.state.stats.B.attempts
              ? 'A'
              : 'B';
      this.finish({ reason: 'TIMEOUT', winnerSeat, draw: false }, now);
    }
    return resolved;
  }

  resolvePunch(attackerSeat: Seat, hand: Hand, now = Date.now()): CombatOutcome | null {
    if (this.state.state !== 'ACTIVE') return null;
    const defenderSeat = otherSeat(attackerSeat);
    const attacker = this.state.players[attackerSeat];
    const defender = this.state.players[defenderSeat];
    const outcome = resolveAttack(attacker, defender, hand);
    const damage =
      outcome === 'HIT'
        ? matchConfig.cleanDamage
        : outcome === 'BLOCK'
          ? matchConfig.blockedDamage
          : 0;
    defender.hp = clamp(Number((defender.hp - damage).toFixed(1)), 0, matchConfig.maxHealth);

    const attackerStats = this.state.stats[attackerSeat];
    const defenderStats = this.state.stats[defenderSeat];
    attackerStats.attempts++;
    if (hand === 'left') attackerStats.leftAttempts++;
    else attackerStats.rightAttempts++;
    if (outcome === 'HIT') attackerStats.cleanHits++;
    else if (outcome === 'BLOCK') defenderStats.blocks++;
    else attackerStats.misses++;
    attackerStats.damageDealt += damage;
    defenderStats.damageReceived += damage;
    if (outcome === 'MISS' && defender.duck) defenderStats.successfulDucks++;

    this.simulationTick++;
    this.state.revision++;
    this.persistence.recordCombat({
      eventId: randomUUID(),
      matchId: this.state.id,
      attackerSeat,
      defenderSeat,
      hand,
      outcome,
      damage,
      resolvedAt: now,
      simulationTick: this.simulationTick,
    });

    if (defender.hp === 0)
      this.finish({ reason: 'KO', winnerSeat: attackerSeat, draw: false }, now);
    return outcome;
  }

  finish(result: MatchResult, now = Date.now()): boolean {
    if (this.state.state === 'FINISHED') return false;
    this.state.state = 'FINISHED';
    this.state.finishedAt = now;
    this.state.result = result;
    this.state.revision++;
    this.persistence.recordFinished(this.state, this.identity);
    return true;
  }
}
