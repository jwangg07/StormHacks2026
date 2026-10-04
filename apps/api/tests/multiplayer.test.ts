import type { MatchSnapshot } from '@wb/core';
import { describe, expect, it, vi } from 'vitest';
import { AuthoritativeMatch, type MatchRuntimeOptions } from '../src/match/state';
import { MultiplayerCoordinator } from '../src/net/multiplayer';
import type { MatchPersistenceService } from '../src/services/matchPersistence';

type Handler = (...args: unknown[]) => void;

class FakeSocket {
  readonly handlers = new Map<string, Handler>();
  readonly outbound: Array<{ event: string; payload: unknown }> = [];
  readonly rooms = new Set<string>();
  connected = true;

  constructor(readonly id: string) {}

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  emit(event: string, payload: unknown): void {
    this.outbound.push({ event, payload });
  }

  join(room: string): void {
    this.rooms.add(room);
  }

  clientEmit(event: string, payload: unknown, ack?: Handler): void {
    this.handlers.get(event)?.(payload, ack);
  }

  messages(event: string): unknown[] {
    return this.outbound.filter((message) => message.event === event).map((message) => message.payload);
  }
}

class FakeIo {
  readonly sockets: FakeSocket[] = [];

  to(room: string) {
    return {
      emit: (event: string, payload: unknown) => {
        for (const socket of this.sockets) {
          if (socket.rooms.has(room)) socket.emit(event, payload);
        }
      },
    };
  }
}

const persistence = {
  recordStarted: vi.fn(() => true),
  recordMovement: vi.fn(() => true),
  recordCombat: vi.fn(() => true),
  recordFinished: vi.fn(() => true),
} as unknown as MatchPersistenceService;

function input(matchId: string, sequence: number) {
  return {
    protocolVersion: 1,
    matchId,
    sequence,
    inputId: `input-${sequence}`,
    clientTimestamp: Date.now(),
    tracking: 'VALID',
    head: { x: 0, y: 0, z: 0 },
    leftHand: { x: 0, y: 0, z: 0 },
    rightHand: { x: 0, y: 0, z: 0 },
    body: { x: 0, z: 0 },
    guard: false,
    duck: false,
    punchAttempt: 'right',
  };
}

describe('minimal two-player flow', () => {
  it('pairs, starts, resolves a punch, and sends identical snapshots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const io = new FakeIo();
    const coordinator = new MultiplayerCoordinator(
      io as never,
      (options: MatchRuntimeOptions) => new AuthoritativeMatch(options, persistence),
    );
    const a = new FakeSocket('socket-a');
    const b = new FakeSocket('socket-b');
    io.sockets.push(a, b);
    coordinator.attach(a as never);
    coordinator.attach(b as never);

    a.clientEmit('matchmaking.join', {});
    b.clientEmit('matchmaking.join', {});
    const matchA = a.messages('matchmaking.matched')[0] as { matchId: string; seat: string };
    const matchB = b.messages('matchmaking.matched')[0] as { matchId: string; seat: string };
    expect(matchA.matchId).toBe(matchB.matchId);
    expect([matchA.seat, matchB.seat]).toEqual(['A', 'B']);

    for (const socket of [a, b]) {
      socket.clientEmit('room.calibrated', { calibrated: true });
      socket.clientEmit('room.ready', { ready: true });
    }
    expect(a.messages('match.countdown')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(a.messages('match.started')).toHaveLength(1);
    expect(b.messages('match.started')).toHaveLength(1);

    const ack = vi.fn();
    a.clientEmit('game.input', input(matchA.matchId, 1), ack);
    expect(ack).toHaveBeenCalledWith({ ok: true });
    expect(a.messages('game.attack')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);

    expect(a.messages('game.hit')).toHaveLength(1);
    expect(b.messages('game.hit')).toHaveLength(1);
    const snapshotA = a.messages('match.snapshot').at(-1) as MatchSnapshot;
    const snapshotB = b.messages('match.snapshot').at(-1) as MatchSnapshot;
    expect(snapshotA.players.B.hp).toBe(92);
    expect(snapshotB.players.B.hp).toBe(92);
    expect(snapshotA.id).toBe(snapshotB.id);
    expect(snapshotA.revision).toBe(snapshotB.revision);

    coordinator.close();
    vi.useRealTimers();
  });
});
