import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Seat } from '@wb/core';

/** Share the local skin with the room; the server validates size and format. */
export async function publishSkin(socket: Socket, skin: Blob) {
  socket.emit('avatar:skin', { jpeg: await skin.arrayBuffer() });
}

/** The opponent's skin JPEG once they share one (pass to useBlobTexture). */
export function useOpponentSkinBlob(socket: Socket | null): Blob | null {
  const [skin, setSkin] = useState<Blob | null>(null);
  useEffect(() => {
    if (!socket) return;
    const receive = ({ jpeg }: { seat: Seat; jpeg: ArrayBuffer }) =>
      setSkin(new Blob([jpeg], { type: 'image/jpeg' }));
    socket.on('avatar:opponentSkin', receive);
    return () => {
      socket.off('avatar:opponentSkin', receive);
    };
  }, [socket]);
  return skin;
}
