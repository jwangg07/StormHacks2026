import type { GameInput, MatchSnapshot, OpponentInputPayload } from '@wb/core';
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
  readonly data: { roomId?: string; seat?: string } = {};

  get volatile() {
    return this;
  }

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
    return this.outbound
      .filter((message) => message.event === event)
      .map((message) => message.payload);
  }

  disconnect(): void {
    this.connected = false;
    this.handlers.get('disconnect')?.();
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
  it('keeps dodge during a punch and clears it on duck or tracking loss', () => {
    const match = new AuthoritativeMatch(
      {
        roomId: 'dodge-room',
        playerASessionId: 'a',
        playerBSessionId: 'b',
        matchType: 'RANDOM',
      },
      persistence,
    );
    match.start(10_000);
    const control = { ...input(match.state.id, 1), dodge: 'left' } as GameInput;
    match.applyInput('A', 'a', control, 10_000);
    expect(match.requestPunch('A', 'left', 10_000)).not.toBeNull();
    expect(match.state.players.A.dodge).toBe('left');
    match.applyInput('A', 'a', { ...control, sequence: 2, duck: true }, 10_050);
    expect(match.state.players.A.dodge).toBeUndefined();
    match.applyInput('A', 'a', { ...control, sequence: 3 }, 10_100);
    expect(match.state.players.A.dodge).toBe('left');
    match.applyInput('A', 'a', { ...control, sequence: 4, tracking: 'LOST' }, 10_150);
    expect(match.state.players.A.dodge).toBeUndefined();
  });

  it.each([
    ['A', 'left'],
    ['A', 'right'],
    ['B', 'left'],
    ['B', 'right'],
  ] as const)(
    'resolves and relays directional dodges against seat %s with hand %s',
    async (seat, hand) => {
      vi.useFakeTimers();
      vi.setSystemTime(10_000);
      const a = new FakeSocket('dodge-a');
      const b = new FakeSocket('dodge-b');
      const { coordinator } = coordinatorWith(a, b);
      try {
        a.clientEmit('matchmaking.join', {});
        b.clientEmit('matchmaking.join', {});
        const { matchId } = a.messages('matchmaking.matched')[0] as { matchId: string };
        const attacker = seat === 'A' ? a : b;
        const defender = seat === 'A' ? b : a;
        const defenderSeat = seat === 'A' ? 'B' : 'A';
        for (const socket of [a, b]) {
          socket.clientEmit('room.calibrated', { calibrated: true });
          socket.clientEmit('room.ready', { ready: true });
        }
        await vi.advanceTimersByTimeAsync(3_000);

        defender.clientEmit('game.input', {
          ...input(matchId, 1),
          punchAttempt: undefined,
          dodge: hand,
          guard: true,
        });
        expect(
          (attacker.messages('game.opponentInput').at(-1) as OpponentInputPayload).input.dodge,
        ).toBe(hand);
        attacker.clientEmit('game.input', { ...input(matchId, 2), punchAttempt: hand });
        await vi.advanceTimersByTimeAsync(500);
        for (const socket of [a, b]) {
          expect(socket.messages('game.miss')).toHaveLength(1);
          expect(socket.messages('game.hit')).toHaveLength(0);
          expect(socket.messages('game.block')).toHaveLength(0);
          const snapshot = socket.messages('match.snapshot').at(-1) as MatchSnapshot;
          expect(snapshot.players[defenderSeat].hp).toBe(100);
          expect(snapshot.players[defenderSeat].dodge).toBe(hand);
          expect(snapshot.stats[seat].misses).toBe(1);
        }

        // The opposite hand still hits a dodging fighter with no guard.
        defender.clientEmit('game.input', {
          ...input(matchId, 3),
          punchAttempt: undefined,
          dodge: hand,
        });
        attacker.clientEmit('game.input', {
          ...input(matchId, 4),
          punchAttempt: hand === 'left' ? 'right' : 'left',
        });
        await vi.advanceTimersByTimeAsync(500);
        expect(
          (a.messages('match.snapshot').at(-1) as MatchSnapshot).players[defenderSeat].hp,
        ).toBe(94);

        // Re-centering during windup releases dodge before the server checks impact.
        attacker.clientEmit('game.input', { ...input(matchId, 5), punchAttempt: hand });
        defender.clientEmit('game.input', { ...input(matchId, 6), punchAttempt: undefined });
        await vi.advanceTimersByTimeAsync(300);
        for (const socket of [a, b]) {
          expect(socket.messages('game.hit')).toHaveLength(2);
          const snapshot = socket.messages('match.snapshot').at(-1) as MatchSnapshot;
          expect(snapshot.players[defenderSeat].hp).toBe(88);
          expect(snapshot.players[defenderSeat].dodge).toBeUndefined();
        }
      } finally {
        coordinator.close();
        vi.useRealTimers();
      }
    },
  );

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
    await vi.advanceTimersByTimeAsync(3_420);
    expect(a.messages('match.started')).toHaveLength(1);
    expect(b.messages('match.started')).toHaveLength(1);

    const ack = vi.fn();
    a.clientEmit('game.input', input(matchA.matchId, 1), ack);
    expect(ack).toHaveBeenCalledWith({ ok: true });
    expect(a.messages('game.attack')).toHaveLength(1);
    expect(a.messages('game.opponentInput')).toHaveLength(0);
    expect(b.messages('game.opponentInput')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);

    expect(a.messages('game.hit')).toHaveLength(1);
    expect(b.messages('game.hit')).toHaveLength(1);
    const snapshotA = a.messages('match.snapshot').at(-1) as MatchSnapshot;
    const snapshotB = b.messages('match.snapshot').at(-1) as MatchSnapshot;
    expect(snapshotA.players.B.hp).toBe(94);
    expect(snapshotB.players.B.hp).toBe(94);
    expect(snapshotA.id).toBe(snapshotB.id);
    expect(snapshotA.revision).toBe(snapshotB.revision);

    coordinator.close();
    vi.useRealTimers();
  });

  it('waits for both confirmed calibrations and cancels the countdown if readiness is lost', async () => {
    vi.useFakeTimers();
    const a = new FakeSocket('calibration-a');
    const b = new FakeSocket('calibration-b');
    const { coordinator } = coordinatorWith(a, b);
    a.clientEmit('matchmaking.join', {});
    b.clientEmit('matchmaking.join', {});

    a.clientEmit('room.calibrated', { calibrated: true });
    a.clientEmit('room.ready', { ready: true });
    expect(a.messages('match.countdown')).toHaveLength(0);
    b.clientEmit('room.calibrated', { calibrated: true });
    expect(a.messages('match.countdown')).toHaveLength(0);
    b.clientEmit('room.ready', { ready: true });
    expect(a.messages('match.countdown')).toHaveLength(1);

    a.clientEmit('room.calibrated', { calibrated: false });
    await vi.advanceTimersByTimeAsync(3_420);
    expect(a.messages('match.started')).toHaveLength(0);
    expect(a.messages('match.countdownCancelled')).toHaveLength(1);

    a.clientEmit('room.calibrated', { calibrated: true });
    expect(a.messages('match.countdown')).toHaveLength(1);
    a.clientEmit('room.ready', { ready: true });
    expect(a.messages('match.countdown')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3_420);
    expect(a.messages('match.started')).toHaveLength(1);
    expect(b.messages('match.started')).toHaveLength(1);
    coordinator.close();
    vi.useRealTimers();
  });

  it('starts WebRTC negotiation only after both peers are ready and relays signaling', () => {
    const a = new FakeSocket('rtc-a');
    const b = new FakeSocket('rtc-b');
    const { coordinator } = coordinatorWith(a, b);
    a.clientEmit('matchmaking.join', {});
    b.clientEmit('matchmaking.join', {});
    const match = a.messages('matchmaking.matched')[0] as { matchId: string };

    a.clientEmit('rtc.ready', { matchId: match.matchId });
    expect(a.messages('rtc.start')).toHaveLength(0);
    b.clientEmit('rtc.ready', { matchId: match.matchId });
    expect(a.messages('rtc.start')).toEqual([{ matchId: match.matchId }]);
    expect(b.messages('rtc.start')).toHaveLength(0);

    a.clientEmit('rtc.signal', {
      matchId: match.matchId,
      description: { type: 'offer', sdp: 'offer-sdp' },
    });
    expect(b.messages('rtc.signal')).toContainEqual({
      matchId: match.matchId,
      description: { type: 'offer', sdp: 'offer-sdp' },
    });

    b.clientEmit('rtc.signal', {
      matchId: match.matchId,
      candidate: { candidate: 'candidate-data', sdpMid: '0', sdpMLineIndex: 0 },
    });
    expect(a.messages('rtc.signal')).toContainEqual({
      matchId: match.matchId,
      candidate: { candidate: 'candidate-data', sdpMid: '0', sdpMLineIndex: 0 },
    });
    coordinator.close();
  });

  it('relays visual poses before the authoritative fight becomes active', () => {
    const a = new FakeSocket('pose-a');
    const b = new FakeSocket('pose-b');
    const { coordinator } = coordinatorWith(a, b);
    a.clientEmit('matchmaking.join', {});
    b.clientEmit('matchmaking.join', {});
    const match = a.messages('matchmaking.matched')[0] as { matchId: string };

    a.clientEmit('game.pose', input(match.matchId, 1));

    expect(a.messages('game.opponentInput')).toHaveLength(0);
    expect(b.messages('game.opponentInput')).toHaveLength(1);
    expect(
      (b.messages('game.opponentInput')[0] as { input: { sequence: number } }).input.sequence,
    ).toBe(1);
    coordinator.close();
  });
});

function coordinatorWith(...sockets: FakeSocket[]) {
  const io = new FakeIo();
  io.sockets.push(...sockets);
  const matchOptions: MatchRuntimeOptions[] = [];
  const coordinator = new MultiplayerCoordinator(io as never, (options: MatchRuntimeOptions) => {
    matchOptions.push(options);
    return new AuthoritativeMatch(options, persistence);
  });
  for (const socket of sockets) coordinator.attach(socket as never);
  return { coordinator, matchOptions };
}

function createdInvite(socket: FakeSocket) {
  socket.clientEmit('invite.create', {});
  return socket.messages('invite.created').at(-1) as {
    inviteId: string;
    code: string;
    expiresAt: number;
  };
}

function lastError(socket: FakeSocket) {
  return socket.messages('error').at(-1) as { code: string };
}

describe('invite matchmaking', () => {
  it('rejects self-acceptance', () => {
    const creator = new FakeSocket('creator');
    const { coordinator } = coordinatorWith(creator);
    const invite = createdInvite(creator);
    creator.clientEmit('invite.accept', { code: invite.code });
    expect(lastError(creator).code).toBe('INVITE_SELF_ACCEPT');
    expect(creator.messages('matchmaking.matched')).toHaveLength(0);
    coordinator.close();
  });

  it('rejects invalid and expired codes with structured errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const creator = new FakeSocket('creator');
    const acceptor = new FakeSocket('acceptor');
    const { coordinator } = coordinatorWith(creator, acceptor);
    acceptor.clientEmit('invite.accept', { code: 'ABC234' });
    expect(lastError(acceptor).code).toBe('INVITE_NOT_FOUND');

    const invite = createdInvite(creator);
    vi.setSystemTime(invite.expiresAt);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(creator.messages('invite.expired')).toContainEqual({ inviteId: invite.inviteId });
    acceptor.clientEmit('invite.accept', { code: invite.code });
    expect(lastError(acceptor).code).toBe('INVITE_EXPIRED');
    coordinator.close();
    vi.useRealTimers();
  });

  it('consumes an invite once and gives both players the same match with opposite seats', () => {
    const creator = new FakeSocket('creator');
    const acceptor = new FakeSocket('acceptor');
    const third = new FakeSocket('third');
    const { coordinator, matchOptions } = coordinatorWith(creator, acceptor, third);
    const invite = createdInvite(creator);
    acceptor.clientEmit('invite.accept', { code: invite.code });

    const creatorMatch = creator.messages('matchmaking.matched').at(-1) as {
      roomId: string;
      matchId: string;
      seat: string;
    };
    const acceptorMatch = acceptor.messages('matchmaking.matched').at(-1) as typeof creatorMatch;
    expect(creatorMatch.matchId).toBe(acceptorMatch.matchId);
    expect(creatorMatch.roomId).toBe(acceptorMatch.roomId);
    expect([creatorMatch.seat, acceptorMatch.seat]).toEqual(['A', 'B']);
    expect(matchOptions.at(-1)?.matchType).toBe('INVITE');

    third.clientEmit('invite.accept', { code: invite.code });
    expect(lastError(third).code).toBe('INVITE_ALREADY_USED');
    expect(third.messages('matchmaking.matched')).toHaveLength(0);
    coordinator.close();
  });

  it('removes creator invites on disconnect and reports the reason', () => {
    const creator = new FakeSocket('creator');
    const acceptor = new FakeSocket('acceptor');
    const { coordinator } = coordinatorWith(creator, acceptor);
    const invite = createdInvite(creator);
    creator.disconnect();
    acceptor.clientEmit('invite.accept', { code: invite.code });
    expect(lastError(acceptor).code).toBe('CREATOR_DISCONNECTED');
    coordinator.close();
  });

  it('clears the remaining player assignment when an active room is abandoned', () => {
    const a = new FakeSocket('a');
    const b = new FakeSocket('b');
    const c = new FakeSocket('c');
    const { coordinator } = coordinatorWith(a, b, c);
    a.clientEmit('matchmaking.join', {});
    b.clientEmit('matchmaking.join', {});
    a.disconnect();

    b.clientEmit('matchmaking.join', {});
    c.clientEmit('matchmaking.join', {});
    expect(b.messages('matchmaking.matched')).toHaveLength(2);
    expect(c.messages('matchmaking.matched')).toHaveLength(1);
    coordinator.close();
  });

  it('lets the creator decline an invite', () => {
    const creator = new FakeSocket('creator');
    const acceptor = new FakeSocket('acceptor');
    const { coordinator } = coordinatorWith(creator, acceptor);
    const invite = createdInvite(creator);
    creator.clientEmit('invite.decline', { inviteId: invite.inviteId });
    expect(creator.messages('invite.declined')).toContainEqual({ inviteId: invite.inviteId });
    acceptor.clientEmit('invite.accept', { code: invite.code });
    expect(lastError(acceptor).code).toBe('INVITE_ALREADY_USED');
    coordinator.close();
  });

  it('uses the same room factory contract for random and invite matches', () => {
    const randomA = new FakeSocket('random-a');
    const randomB = new FakeSocket('random-b');
    const inviteA = new FakeSocket('invite-a');
    const inviteB = new FakeSocket('invite-b');
    const { coordinator, matchOptions } = coordinatorWith(randomA, randomB, inviteA, inviteB);
    randomA.clientEmit('matchmaking.join', {});
    randomB.clientEmit('matchmaking.join', {});
    const invite = createdInvite(inviteA);
    inviteB.clientEmit('invite.accept', { code: invite.code });

    expect(matchOptions.map(({ matchType }) => matchType)).toEqual(['RANDOM', 'INVITE']);
    for (const options of matchOptions) {
      expect(options.roomId).toEqual(expect.any(String));
      expect(options.playerASessionId).toEqual(expect.any(String));
      expect(options.playerBSessionId).toEqual(expect.any(String));
    }
    coordinator.close();
  });
});
