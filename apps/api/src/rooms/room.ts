import type { Seat } from '@wb/core';

export interface RoomPlayer {
  seat: Seat;
  socketId: string;
  sessionToken: string;
  displayName: string;
  ready: boolean;
}

export interface Room {
  id: string;
  code: string;
  players: Partial<Record<Seat, RoomPlayer>>;
}
