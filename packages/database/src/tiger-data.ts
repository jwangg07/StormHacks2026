import type { Pool } from 'pg';
import type { CombatEvent, MatchPersistence, MovementSample, PersistedMatch } from './types';

const MATCH_COLUMNS = `
  id, created_at, started_at, ended_at, status,
  player_a_session_id, player_b_session_id, winner_seat,
  final_hp_a, final_hp_b, match_type, config_version
`;

function matchValues(match: PersistedMatch): unknown[] {
  return [
    match.id,
    match.createdAt,
    match.startedAt ?? null,
    match.endedAt ?? null,
    match.status,
    match.playerASessionId ?? null,
    match.playerBSessionId ?? null,
    match.winnerSeat ?? null,
    match.finalHpA ?? null,
    match.finalHpB ?? null,
    match.matchType,
    match.configVersion,
  ];
}

function placeholders(rows: number, columns: number): string {
  return Array.from({ length: rows }, (_, row) => {
    const offset = row * columns;
    return `(${Array.from({ length: columns }, (_, column) => `$${offset + column + 1}`).join(', ')})`;
  }).join(', ');
}

export class TigerDataPersistence implements MatchPersistence {
  constructor(private readonly pool: Pool) {}

  async saveMatchStarted(match: PersistedMatch): Promise<void> {
    await this.pool.query(
      `INSERT INTO matches (${MATCH_COLUMNS})
       VALUES (${Array.from({ length: 12 }, (_, index) => `$${index + 1}`).join(', ')})
       ON CONFLICT (id) DO UPDATE SET
         started_at = COALESCE(matches.started_at, EXCLUDED.started_at),
         status = EXCLUDED.status`,
      matchValues(match),
    );
  }

  async saveCombatEvents(events: readonly CombatEvent[]): Promise<void> {
    if (events.length === 0) return;
    const values = events.flatMap((event) => [
      event.time,
      event.eventId,
      event.matchId,
      event.attackerSeat ?? null,
      event.defenderSeat ?? null,
      event.hand ?? null,
      event.eventType,
      event.outcome ?? null,
      event.damage ?? null,
      event.simulationTick?.toString() ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null,
    ]);
    await this.pool.query(
      `INSERT INTO combat_events (
         time, event_id, match_id, attacker_seat, defender_seat, hand,
         event_type, outcome, damage, simulation_tick, metadata
       ) VALUES ${placeholders(events.length, 11)}
       ON CONFLICT (time, event_id) DO NOTHING`,
      values,
    );
  }

  async saveMovementSamples(samples: readonly MovementSample[]): Promise<void> {
    if (samples.length === 0) return;
    const values = samples.flatMap((sample) => [
      sample.time,
      sample.matchId,
      sample.sessionId,
      sample.seat,
      sample.sequence,
      sample.head?.x ?? null,
      sample.head?.y ?? null,
      sample.head?.z ?? null,
      sample.leftHand?.x ?? null,
      sample.leftHand?.y ?? null,
      sample.leftHand?.z ?? null,
      sample.rightHand?.x ?? null,
      sample.rightHand?.y ?? null,
      sample.rightHand?.z ?? null,
      sample.body?.x ?? null,
      sample.body?.z ?? null,
      sample.leftVelocity ?? null,
      sample.rightVelocity ?? null,
      sample.trackingConfidence ?? null,
      sample.guard ?? null,
      sample.duck ?? null,
    ]);
    await this.pool.query(
      `INSERT INTO movement_data (
         time, match_id, session_id, seat, sequence,
         head_x, head_y, head_z,
         left_hand_x, left_hand_y, left_hand_z,
         right_hand_x, right_hand_y, right_hand_z,
         body_x, body_z, left_velocity, right_velocity,
         tracking_confidence, guard, duck
       ) VALUES ${placeholders(samples.length, 21)}
       ON CONFLICT (time, match_id, session_id, sequence) DO NOTHING`,
      values,
    );
  }

  async saveMatchFinished(match: PersistedMatch): Promise<void> {
    await this.pool.query(
      `INSERT INTO matches (${MATCH_COLUMNS})
       VALUES (${Array.from({ length: 12 }, (_, index) => `$${index + 1}`).join(', ')})
       ON CONFLICT (id) DO UPDATE SET
         ended_at = EXCLUDED.ended_at,
         status = EXCLUDED.status,
         winner_seat = EXCLUDED.winner_seat,
         final_hp_a = EXCLUDED.final_hp_a,
         final_hp_b = EXCLUDED.final_hp_b`,
      matchValues(match),
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
