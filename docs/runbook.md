# Development runbook

1. Install Node.js 24+ and npm 12+.
2. Run `npm ci` from the repository root.
3. Run `npm run dev` to start the Vite client and API watcher.
4. Open `http://localhost:5173`; use `http://localhost:3001/health` to inspect API readiness.

For a deployed build, serve the web bundle over HTTPS and run the API on a persistent Node host that supports WebSocket connections. Set `WEB_ORIGIN` to the exact client origin and `PORT` to the host-provided port. Keep provider credentials on the API only. Active in-memory rooms are lost when the API process restarts.

## Test two camera clients over HTTPS

Browsers require a secure context for camera access on devices other than the development host. The web development server proxies `/socket.io` to the local API, so a single HTTPS tunnel can carry both the page and multiplayer connection.

1. Start the web server:

   ```bash
   npm run dev:web
   ```

2. In another terminal, create a temporary HTTPS tunnel:

   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```

3. Copy the printed `https://...trycloudflare.com` URL and start the API with that exact origin:

   ```bash
   WEB_ORIGIN=https://YOUR-TUNNEL.trycloudflare.com npm run dev:api
   ```

4. Open the same tunnel URL on both devices. Anyone with the temporary URL can reach the development app until the tunnel stops, so do not share it publicly.
