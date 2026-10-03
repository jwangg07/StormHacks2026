# Development runbook

1. Install Node.js 24+ and npm 12+.
2. Run `npm ci` from the repository root.
3. Run `npm run dev` to start the Vite client and API watcher.
4. Open `http://localhost:5173`; use `http://localhost:3001/health` to inspect API readiness.

For a deployed build, serve the web bundle over HTTPS and run the API on a persistent Node host that supports WebSocket connections. Set `WEB_ORIGIN` to the exact client origin and `PORT` to the host-provided port. Keep provider credentials on the API only. Active in-memory rooms are lost when the API process restarts.
