import { avatarSkinSchema } from '@wb/core';
import type { Seat, ServerErrorPayload } from '@wb/core';
import type { Socket } from 'socket.io';
import type { SkinRelay } from './skinRelay';

type SkinAck = (result: { ok: true } | { ok: false; error: ServerErrorPayload }) => void;
/** Set by the room-join handler. */
interface RoomMembership {
  roomId?: string;
  seat?: Seat;
}
type AvatarSocket = Pick<Socket, 'on' | 'to' | 'emit'> & { data: RoomMembership };

export function addAvatarHandlers(socket: AvatarSocket, relay: SkinRelay) {
  socket.on('avatar:requestOpponentSkin', () => {
    const { roomId, seat } = socket.data;
    if (roomId && seat) sendOpponentSkin(socket, relay, roomId, seat);
  });
  socket.on('avatar:skin', (payload: unknown, ack?: unknown) => {
    const reply: SkinAck = typeof ack === 'function' ? (ack as SkinAck) : () => {};
    const { roomId, seat } = socket.data;
    if (!roomId || !seat) {
      reply({
        ok: false,
        error: {
          code: 'NOT_IN_ROOM',
          message: 'Join a room before sharing a skin.',
          recoverable: true,
        },
      });
      return;
    }
    const parsed = avatarSkinSchema.safeParse(payload);
    if (!parsed.success) {
      reply({
        ok: false,
        error: {
          code: 'INVALID_SKIN',
          message: 'Skin must be a JPEG of at most 256 KB.',
          recoverable: true,
        },
      });
      return;
    }
    relay.set(roomId, seat, parsed.data.jpeg);
    socket.to(roomId).emit('avatar:opponentSkin', { seat, jpeg: parsed.data.jpeg });
    reply({ ok: true });
  });
}

/** Replay the opponent's skin to a player who joins after it was shared. */
export function sendOpponentSkin(
  socket: AvatarSocket,
  relay: SkinRelay,
  roomId: string,
  seat: Seat,
) {
  const opponent = relay.opponentOf(roomId, seat);
  if (opponent) socket.emit('avatar:opponentSkin', opponent);
}
