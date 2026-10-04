import type { OpponentSkinPayload, Seat } from '@wb/core';

/** Latest skin per seat per room, in memory only; dropped when the room closes. */
export class SkinRelay {
  private readonly rooms = new Map<string, Partial<Record<Seat, Uint8Array>>>();

  set(roomId: string, seat: Seat, jpeg: Uint8Array) {
    this.rooms.set(roomId, { ...this.rooms.get(roomId), [seat]: jpeg });
  }

  opponentOf(roomId: string, seat: Seat): OpponentSkinPayload | null {
    const other: Seat = seat === 'A' ? 'B' : 'A';
    const jpeg = this.rooms.get(roomId)?.[other];
    return jpeg ? { seat: other, jpeg } : null;
  }

  closeRoom(roomId: string) {
    this.rooms.delete(roomId);
  }
}
