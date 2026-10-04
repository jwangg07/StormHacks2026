import { io } from 'socket.io-client';

// Default to the page origin so HTTPS tunnels can proxy Socket.IO without
// mixed-content errors. Set VITE_API_URL only when the API has its own origin.
const apiUrl = import.meta.env.VITE_API_URL || undefined;

export function createGameSocket() {
  return io(apiUrl, { autoConnect: false, transports: ['websocket'] });
}
