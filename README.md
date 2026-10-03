# WebcamBoxer

A browser multiplayer boxing game controlled by local webcam motion. See [the PRD](./prd.md) for product scope and [the project plan](./PROJECT_PLAN.md) for workstreams and release gates.

## Requirements

- Node.js 24 or newer
- npm 12 or newer

## Start locally

```powershell
npm ci
npm run dev
```

The web app runs at `http://localhost:5173`; the API health endpoint is `http://localhost:3001/health`. Copy `.env.example` to `.env` to override local API settings. Never put provider secrets in the web app environment.

## Workspace

- `apps/web` — React, Vite, Three.js game client
- `apps/api` — Express and Socket.IO game server
- `packages/core` — shared protocol schemas and game constants
- `packages/motion` — camera-independent motion feature types

Useful commands: `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`.

This is an initial scaffold. Room flow, pose detection, and combat are not implemented yet.
