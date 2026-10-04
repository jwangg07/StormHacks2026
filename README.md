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

## Voice coach

The optional voice coach uses ElevenLabs speech for calibration instructions and multiplayer fight callouts. Add `ELEVENLABS_API_KEY` to the API's environment (the root `.env` for local development). The key stays on the API server; the browser requests only predefined cue IDs. `ELEVENLABS_VOICE_ID` defaults to the premade George voice and can be set to another voice ID available to your ElevenLabs account. Voice playback is enabled by default; use the voice icon in `/game` to mute or enable it. Browsers may require a tap on that icon before they allow spoken audio.

The API generates each short cue once and caches the audio in memory. It uses ElevenLabs' `eleven_multilingual_v2` model and MP3 output. Without an API key, gameplay remains available and the voice coach shows as offline.

## Workspace

- `apps/web` — React, Vite, Three.js game client
- `apps/api` — Express and Socket.IO game server
- `packages/core` — shared protocol schemas and game constants
- `packages/motion` — camera-independent motion feature types

Useful commands: `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`.
