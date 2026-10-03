import type { Server } from 'node:http';
import { Server as SocketServer } from 'socket.io';

export function addSockets(server: Server, webOrigin: string) {
  const io = new SocketServer(server, { cors: { origin: webOrigin } });

  io.on('connection', (socket) => {
    socket.emit('server:ready', { connected: true });
  });

  return io;
}
