import {
  calibratedSchema,
  gameInputSchema,
  matchConfig,
  readySchema,
  type MatchSnapshot,
  type Seat,
  type ServerErrorPayload,
} from '@wb/core';
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { AuthoritativeMatch, MatchRuntimeOptions } from '../match/state';

type Ack = (response: { ok: true } | { ok: false; error: ServerErrorPayload }) => void;

interface Player {
  sessionId: string;
  socket: Socket;
  roomId?: string;
  seat?: Seat;
}

interface Room {
  id: string;
  players: Record<Seat, Player>;
  calibrated: Record<Seat, boolean>;
  ready: Record<Seat, boolean>;
  match: AuthoritativeMatch;
  countdownStarted: boolean;
  inputIds: Set<string>;
}

const error = (code: string, message: string, recoverable = true): ServerErrorPayload => ({
  code,
  message,
  recoverable,
});

export class MultiplayerCoordinator {
  private readonly players = new Map<string, Player>();
  private readonly queue: Player[] = [];
  private readonly rooms = new Map<string, Room>();
  private readonly inputWindows = new Map<string, number[]>();
  private readonly simulationTimer: NodeJS.Timeout;
  private readonly snapshotTimer: NodeJS.Timeout;

  constructor(
    private readonly io: Server,
    private readonly createMatch: (options: MatchRuntimeOptions) => AuthoritativeMatch,
  ) {
    this.simulationTimer = setInterval(() => this.tick(), 1_000 / matchConfig.tickRate);
    this.snapshotTimer = setInterval(() => this.broadcastSnapshots(), 1_000 / matchConfig.snapshotRate);
    this.simulationTimer.unref();
    this.snapshotTimer.unref();
  }

  attach(socket: Socket): void {
    const player: Player = { sessionId: randomUUID(), socket };
    this.players.set(socket.id, player);
    socket.emit('session.created', { sessionId: player.sessionId });

    socket.on('matchmaking.join', (_payload: unknown, ack?: Ack) => {
      if (player.roomId) return this.reject(socket, ack, 'ALREADY_IN_MATCH', 'Already in a match');
      if (!this.queue.includes(player)) this.queue.push(player);
      socket.emit('matchmaking.queued', { queued: true });
      ack?.({ ok: true });
      this.pairWaitingPlayers();
    });

    socket.on('matchmaking.leave', (_payload: unknown, ack?: Ack) => {
      this.removeFromQueue(player);
      ack?.({ ok: true });
    });

    socket.on('room.calibrated', (payload: unknown, ack?: Ack) => {
      const parsed = calibratedSchema.safeParse(payload);
      const room = this.roomFor(player);
      if (!parsed.success || !room || !player.seat)
        return this.reject(socket, ack, 'INVALID_INPUT', 'Invalid calibration update');
      room.calibrated[player.seat] = parsed.data.calibrated;
      ack?.({ ok: true });
      this.maybeCountdown(room);
    });

    socket.on('room.ready', (payload: unknown, ack?: Ack) => {
      const parsed = readySchema.safeParse(payload);
      const room = this.roomFor(player);
      if (!parsed.success || !room || !player.seat)
        return this.reject(socket, ack, 'INVALID_INPUT', 'Invalid ready update');
      room.ready[player.seat] = parsed.data.ready;
      ack?.({ ok: true });
      this.maybeCountdown(room);
    });

    socket.on('game.input', (payload: unknown, ack?: Ack) => {
      if (Buffer.byteLength(JSON.stringify(payload)) > 4_096)
        return this.reject(socket, ack, 'INVALID_INPUT', 'Packet exceeds 4 KB');
      if (!this.withinRateLimit(socket.id))
        return this.reject(socket, ack, 'RATE_LIMITED', 'Too many gameplay inputs');
      const parsed = gameInputSchema.safeParse(payload);
      const room = this.roomFor(player);
      if (!parsed.success || !room || !player.seat)
        return this.reject(socket, ack, 'INVALID_INPUT', 'Malformed gameplay input');
      if (parsed.data.matchId !== room.match.state.id)
        return this.reject(socket, ack, 'INVALID_INPUT', 'Wrong match ID');
      if (room.inputIds.has(parsed.data.inputId))
        return this.reject(socket, ack, 'DUPLICATE_INPUT', 'Input already processed');
      room.inputIds.add(parsed.data.inputId);
      if (room.inputIds.size > 256) room.inputIds.delete(room.inputIds.values().next().value as string);
      if (!room.match.applyInput(player.seat, player.sessionId, parsed.data))
        return this.reject(socket, ack, 'STALE_INPUT', 'Input rejected');

      if (parsed.data.punchAttempt) {
        const attack = room.match.requestPunch(player.seat, parsed.data.punchAttempt);
        if (!attack)
          return this.reject(socket, ack, 'MATCH_NOT_ACTIVE', 'Punch rejected by match rules');
        this.io.to(room.id).emit('game.attack', attack);
      }
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => this.disconnect(player));
  }

  close(): void {
    clearInterval(this.simulationTimer);
    clearInterval(this.snapshotTimer);
  }

  private pairWaitingPlayers(): void {
    while (this.queue.length >= 2) {
      const a = this.queue.shift();
      const b = this.queue.shift();
      if (!a || !b || !a.socket.connected || !b.socket.connected) continue;
      const roomId = randomUUID();
      a.roomId = roomId;
      a.seat = 'A';
      b.roomId = roomId;
      b.seat = 'B';
      a.socket.join(roomId);
      b.socket.join(roomId);
      const match = this.createMatch({
        roomId,
        playerASessionId: a.sessionId,
        playerBSessionId: b.sessionId,
        matchType: 'RANDOM',
      });
      const room: Room = {
        id: roomId,
        players: { A: a, B: b },
        calibrated: { A: false, B: false },
        ready: { A: false, B: false },
        match,
        countdownStarted: false,
        inputIds: new Set(),
      };
      this.rooms.set(roomId, room);
      for (const seat of ['A', 'B'] as const) {
        room.players[seat].socket.emit('matchmaking.matched', {
          roomId,
          matchId: match.state.id,
          seat,
        });
      }
      this.io.to(roomId).emit('room.snapshot', this.roomSnapshot(room));
    }
  }

  private maybeCountdown(room: Room): void {
    this.io.to(room.id).emit('room.snapshot', this.roomSnapshot(room));
    if (
      room.countdownStarted ||
      !room.ready.A ||
      !room.ready.B ||
      !room.calibrated.A ||
      !room.calibrated.B
    )
      return;
    room.countdownStarted = true;
    const startsAt = Date.now() + 3_000;
    this.io.to(room.id).emit('match.countdown', { matchId: room.match.state.id, startsAt });
    const timer = setTimeout(() => {
      if (!this.rooms.has(room.id) || !room.match.start()) return;
      this.io.to(room.id).emit('match.started', this.snapshot(room.match));
    }, 3_000);
    timer.unref();
  }

  private tick(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const before = room.match.state.state;
      for (const resolved of room.match.tick(now)) {
        this.io.to(room.id).emit(`game.${resolved.outcome.toLowerCase()}`, resolved);
      }
      if (before !== 'FINISHED' && room.match.state.state === 'FINISHED') {
        this.io.to(room.id).emit('match.finished', this.snapshot(room.match));
      }
    }
  }

  private broadcastSnapshots(): void {
    for (const room of this.rooms.values()) {
      if (room.match.state.state === 'ACTIVE' || room.match.state.state === 'FINISHED') {
        this.io.to(room.id).emit('match.snapshot', this.snapshot(room.match));
      }
    }
  }

  private snapshot(match: AuthoritativeMatch): MatchSnapshot {
    return { ...match.state, serverTimestamp: Date.now() };
  }

  private roomSnapshot(room: Room) {
    return {
      roomId: room.id,
      matchId: room.match.state.id,
      state: room.match.state.state,
      players: {
        A: { connected: room.players.A.socket.connected, ...this.readyState(room, 'A') },
        B: { connected: room.players.B.socket.connected, ...this.readyState(room, 'B') },
      },
    };
  }

  private readyState(room: Room, seat: Seat) {
    return { calibrated: room.calibrated[seat], ready: room.ready[seat] };
  }

  private roomFor(player: Player): Room | undefined {
    return player.roomId ? this.rooms.get(player.roomId) : undefined;
  }

  private withinRateLimit(socketId: string): boolean {
    const now = Date.now();
    const recent = (this.inputWindows.get(socketId) ?? []).filter((time) => now - time < 1_000);
    if (recent.length >= 30) return false;
    recent.push(now);
    this.inputWindows.set(socketId, recent);
    return true;
  }

  private disconnect(player: Player): void {
    this.players.delete(player.socket.id);
    this.inputWindows.delete(player.socket.id);
    this.removeFromQueue(player);
    const room = this.roomFor(player);
    if (!room || room.match.state.state === 'FINISHED') return;
    room.match.finish({ reason: 'ABANDONED', draw: true });
    this.io.to(room.id).emit('match.finished', this.snapshot(room.match));
  }

  private removeFromQueue(player: Player): void {
    const index = this.queue.indexOf(player);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private reject(socket: Socket, ack: Ack | undefined, code: string, message: string): void {
    const payload = error(code, message);
    ack?.({ ok: false, error: payload });
    socket.emit('error', payload);
  }
}
