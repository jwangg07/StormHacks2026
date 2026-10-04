import type { Server } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { addAvatarHandlers } from '../avatar/socket';
import { SkinRelay } from '../avatar/skinRelay';

export function addSockets(server: Server, webOrigin: string) {
  const io = new SocketServer(server, { cors: { origin: webOrigin } });
  const skins = new SkinRelay();

  io.on('connection', (socket) => {
    socket.emit('server:ready', { connected: true });
    addAvatarHandlers(socket, skins);
  });

  return io;
}
