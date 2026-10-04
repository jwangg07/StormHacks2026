import {
  calibratedSchema,
  gameInputSchema,
  inviteAcceptSchema,
  inviteActionSchema,
  inviteCreateSchema,
  matchConfig,
  readySchema,
  type MatchSnapshot,
  type Seat,
  type ServerErrorPayload,
} from '@wb/core';
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { InviteService, type Invite } from '../invites/service';
import type { AuthoritativeMatch, MatchRuntimeOptions } from '../match/state';

type Ack = (response: { ok: true } | { ok: false; error: ServerErrorPayload }) => void;

interface Player {
  sessionId: string;
  socket: Socket;
  roomId?: string;
  seat?: Seat;
  acceptingInvite: boolean;
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
  private readonly playersBySocketId = new Map<string, Player>();
  private readonly playersBySessionId = new Map<string, Player>();
  private readonly queue: Player[] = [];
  private readonly rooms = new Map<string, Room>();
  private readonly inputWindows = new Map<string, number[]>();
  private readonly inviteCreateWindows = new Map<string, number[]>();
  private readonly inviteAcceptWindows = new Map<string, number[]>();
  private readonly invites = new InviteService();
  private readonly simulationTimer: NodeJS.Timeout;
  private readonly snapshotTimer: NodeJS.Timeout;
  private readonly inviteCleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly io: Server,
    private readonly createMatch: (options: MatchRuntimeOptions) => AuthoritativeMatch,
  ) {
    this.simulationTimer = setInterval(() => this.tick(), 1_000 / matchConfig.tickRate);
    this.snapshotTimer = setInterval(
      () => this.broadcastSnapshots(),
      1_000 / matchConfig.snapshotRate,
    );
    this.inviteCleanupTimer = setInterval(() => this.cleanupExpiredInvites(), 1_000);
    this.simulationTimer.unref();
    this.snapshotTimer.unref();
    this.inviteCleanupTimer.unref();
  }

  attach(socket: Socket): void {
    const player: Player = { sessionId: randomUUID(), socket, acceptingInvite: false };
    this.playersBySocketId.set(socket.id, player);
    this.playersBySessionId.set(player.sessionId, player);
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

    socket.on('invite.create', (payload: unknown, ack?: Ack) => {
      if (!inviteCreateSchema.safeParse(payload).success)
        return this.reject(socket, ack, 'INVALID_INPUT', 'Invalid invite request');
      if (player.roomId) return this.reject(socket, ack, 'ALREADY_IN_MATCH', 'Already in a match');
      if (!this.withinWindow(this.inviteCreateWindows, player.sessionId, 3, 60_000))
        return this.reject(socket, ack, 'RATE_LIMITED', 'Too many invite creations');
      const invite = this.invites.create(player.sessionId);
      socket.emit('invite.created', this.invitePayload(invite));
      ack?.({ ok: true });
    });

    socket.on('invite.accept', (payload: unknown, ack?: Ack) => {
      if (!this.withinWindow(this.inviteAcceptWindows, player.sessionId, 6, 60_000))
        return this.reject(socket, ack, 'RATE_LIMITED', 'Too many invite attempts');
      const parsed = inviteAcceptSchema.safeParse(payload);
      if (!parsed.success) return this.reject(socket, ack, 'INVITE_NOT_FOUND', 'Invite not found');
      const lookup = this.invites.lookup(parsed.data.code);
      if (lookup.status === 'NOT_FOUND')
        return this.reject(socket, ack, 'INVITE_NOT_FOUND', 'Invite not found');
      if (lookup.status === 'EXPIRED') {
        if (lookup.invite)
          this.playersBySessionId
            .get(lookup.invite.creatorSessionId)
            ?.socket.emit('invite.expired', { inviteId: lookup.invite.id });
        return this.reject(socket, ack, 'INVITE_EXPIRED', 'Invite has expired');
      }
      if (lookup.status === 'USED')
        return this.reject(socket, ack, 'INVITE_ALREADY_USED', 'Invite has already been used');
      if (lookup.status === 'CREATOR_DISCONNECTED')
        return this.reject(socket, ack, 'CREATOR_DISCONNECTED', 'Invite creator disconnected');

      const invite = lookup.invite;
      if (invite.creatorSessionId === player.sessionId)
        return this.reject(socket, ack, 'INVITE_SELF_ACCEPT', 'Cannot accept your own invite');
      const creator = this.playersBySessionId.get(invite.creatorSessionId);
      if (!creator?.socket.connected)
        return this.reject(socket, ack, 'CREATOR_DISCONNECTED', 'Invite creator disconnected');
      if (creator.roomId || player.roomId)
        return this.reject(socket, ack, 'ALREADY_IN_MATCH', 'A player is already in a match');
      if (creator.acceptingInvite || player.acceptingInvite)
        return this.reject(
          socket,
          ack,
          'INVITE_ALREADY_USED',
          'A player is accepting another invite',
        );

      creator.acceptingInvite = true;
      player.acceptingInvite = true;
      try {
        if (!this.invites.consume(invite))
          return this.reject(socket, ack, 'INVITE_ALREADY_USED', 'Invite has already been used');
        this.removeFromQueue(creator);
        this.removeFromQueue(player);
        this.createRoom(creator, player, 'INVITE');
        ack?.({ ok: true });
      } finally {
        creator.acceptingInvite = false;
        player.acceptingInvite = false;
      }
    });

    socket.on('invite.decline', (payload: unknown, ack?: Ack) => {
      const parsed = inviteActionSchema.safeParse(payload);
      if (!parsed.success) return this.reject(socket, ack, 'INVITE_NOT_FOUND', 'Invite not found');
      const invite = this.invites.decline(parsed.data.inviteId, player.sessionId);
      if (!invite) return this.reject(socket, ack, 'INVITE_NOT_FOUND', 'Invite not found');
      socket.emit('invite.declined', { inviteId: invite.id });
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
      if (room.inputIds.size > 256)
        room.inputIds.delete(room.inputIds.values().next().value as string);
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
    clearInterval(this.inviteCleanupTimer);
  }

  private pairWaitingPlayers(): void {
    while (this.queue.length >= 2) {
      const a = this.queue.shift();
      const b = this.queue.shift();
      if (!a || !b || !a.socket.connected || !b.socket.connected) continue;
      this.createRoom(a, b, 'RANDOM');
    }
  }

  private createRoom(playerA: Player, playerB: Player, matchType: 'RANDOM' | 'INVITE'): Room {
    this.invites.removeForCreator(playerA.sessionId, 'USED');
    this.invites.removeForCreator(playerB.sessionId, 'USED');
    const roomId = randomUUID();
    playerA.roomId = roomId;
    playerA.seat = 'A';
    playerB.roomId = roomId;
    playerB.seat = 'B';
    playerA.socket.join(roomId);
    playerB.socket.join(roomId);
    const match = this.createMatch({
      roomId,
      playerASessionId: playerA.sessionId,
      playerBSessionId: playerB.sessionId,
      matchType,
    });
    const room: Room = {
      id: roomId,
      players: { A: playerA, B: playerB },
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
    return room;
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
        this.cleanupRoom(room);
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

  private withinWindow(
    windows: Map<string, number[]>,
    key: string,
    limit: number,
    durationMs: number,
  ): boolean {
    const now = Date.now();
    const recent = (windows.get(key) ?? []).filter((time) => now - time < durationMs);
    if (recent.length >= limit) return false;
    recent.push(now);
    windows.set(key, recent);
    return true;
  }

  private invitePayload(invite: Invite) {
    return { inviteId: invite.id, code: invite.code, expiresAt: invite.expiresAt };
  }

  private cleanupExpiredInvites(): void {
    for (const invite of this.invites.cleanupExpired()) {
      this.playersBySessionId.get(invite.creatorSessionId)?.socket.emit('invite.expired', {
        inviteId: invite.id,
      });
    }
  }

  private disconnect(player: Player): void {
    this.playersBySocketId.delete(player.socket.id);
    this.playersBySessionId.delete(player.sessionId);
    this.inputWindows.delete(player.socket.id);
    this.inviteCreateWindows.delete(player.sessionId);
    this.inviteAcceptWindows.delete(player.sessionId);
    this.invites.removeForCreator(player.sessionId, 'CREATOR_DISCONNECTED');
    this.removeFromQueue(player);
    const room = this.roomFor(player);
    if (!room || room.match.state.state === 'FINISHED') return;
    room.match.finish({ reason: 'ABANDONED', draw: true });
    this.io.to(room.id).emit('match.finished', this.snapshot(room.match));
    this.cleanupRoom(room);
  }

  private cleanupRoom(room: Room): void {
    if (!this.rooms.delete(room.id)) return;
    for (const player of Object.values(room.players)) {
      if (player.roomId === room.id) {
        player.roomId = undefined;
        player.seat = undefined;
      }
    }
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
