import type { Server } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { addAvatarHandlers } from '../avatar/socket';
import { SkinRelay } from '../avatar/skinRelay';
import type { AuthoritativeMatch, MatchRuntimeOptions } from '../match/state';
import { MultiplayerCoordinator } from './multiplayer';

export function addSockets(
  server: Server,
  webOrigin: string,
  createMatch: (options: MatchRuntimeOptions) => AuthoritativeMatch,
) {
  const io = new SocketServer(server, { cors: { origin: webOrigin } });
  const skins = new SkinRelay();
  const multiplayer = new MultiplayerCoordinator(io, createMatch);

  io.on('connection', (socket) => {
    socket.emit('server:ready', { connected: true });
    addAvatarHandlers(socket, skins);
    multiplayer.attach(socket);
  });

  return { io, multiplayer };
}
