# WebcamBoxer implementation plan

**Planning baseline:** `prd.md` v1.0 (2026-10-03)  
**Team:** three developers, 24-hour hackathon  
**Repository state:** scaffolded workspace; P0 gameplay is not implemented  
**Status:** implementation plan; external event and deployment rules still need verification

## Product slice

Ship a desktop-browser, two-player, webcam-controlled boxing match. Keep pose inference on each player's device; send only normalized controls and game inputs. The server owns rooms, match timing, accepted attacks, health, outcomes, and result counters. Three.js must be in the P0 build. P0 uses procedural robot fighters, one 60-second round, 100 HP, left/right punches, guard, duck, and keyboard input only in labeled developer mode.

Tiger Data persistence, Gemini analysis, and ElevenLabs narration are P1. They begin only after the 12-hour P0 gate has passed. P2 stays out of this hackathon implementation unless scope is explicitly revised.

## Target repository structure

Use a small npm workspace with TypeScript project references (or equivalent path aliases) so `packages/core` is shared by both apps. Keep the workspace toolchain deliberately small; do not introduce a second frontend state framework or a separate ML framework. Pin compatible dependency versions in the lockfile at scaffold time.

```text
WebcamBoxer/
├─ apps/
│  ├─ web/
│  │  ├─ public/models/                 # pinned MediaPipe model/WASM assets
│  │  └─ src/
│  │     ├─ app/                        # routes, screen state, providers
│  │     ├─ ui/                         # screens, HUD, forms, dialogs, settings
│  │     ├─ game/
│  │     │  ├─ Arena.tsx                # R3F canvas and ring
│  │     │  ├─ fighters/                # procedural robot, joints, materials
│  │     │  ├─ animation/               # authored punch/guard/duck effects
│  │     │  └─ effects/                 # trails, flashes, optional shake
│  │     ├─ cam/                        # camera selection, preview, teardown
│  │     ├─ motion/
│  │     │  ├─ pose.worker.ts           # worker-owned MediaPipe lifecycle
│  │     │  ├─ inferenceClient.ts       # bounded frame handoff/results
│  │     │  └─ useMotionControls.ts     # detector-to-input adapter
│  │     ├─ net/                        # Socket.IO client and protocol adapter
│  │     ├─ state/                      # lifecycle/snapshot store and selectors
│  │     ├─ settings/                   # mute, reduced motion, sensitivity
│  │     ├─ styles/
│  │     └─ main.tsx
│  └─ api/
│     └─ src/
│        ├─ http/                       # health/readiness and static-independent API
│        ├─ net/                        # origin policy, auth, event handlers
│        ├─ rooms/                      # room codes, seats, reconnect, expiry
│        ├─ match/                      # lifecycle, tick loop, combat, counters
│        ├─ services/                   # persistence/AI/audio adapters (P1)
│        ├─ config/                     # validated environment and limits
│        └─ main.ts
├─ packages/
│  ├─ core/                             # shared protocol, rules, combat geometry
│  │  └─ src/
│  │     ├─ protocol.ts                 # runtime packet schemas and shared types
│  │     ├─ rules.ts                    # match constants
│  │     └─ index.ts
│  └─ motion/
│     └─ src/
│        ├─ types.ts                    # normalized landmark/features contract
│        ├─ calibration.ts
│        ├─ normalize.ts
│        ├─ history.ts
│        ├─ detectors/                  # punch, guard, duck state machines
│        └─ tracking.ts                 # validity and pause thresholds
├─ docs/
│  ├─ architecture.md                  # trust boundaries and message flow
│  ├─ runbook.md                       # setup, env vars, deploy, demo recovery
│  └─ verification.md                  # manual 2-device release checklist
├─ .env.example                         # names only; no secrets
├─ .gitignore
├─ package.json                        # workspace scripts
├─ package-lock.json
├─ tsconfig.base.json
├─ eslint.config.js
├─ prettier.config.js
├─ README.md
└─ prd.md
```

The tree is a target layout, not a requirement to create empty directories up front. Add only files as their owning workstream reaches them. Keep P1 adapters behind server-side interfaces so P0 match code does not import or await external services.

## Tech stack

| Area | Choice | Why / boundary |
|---|---|---|
| Language | TypeScript across browser, server, and shared code | One set of packet and domain types; runtime validation still required at network edges. |
| Workspace | npm workspaces + TypeScript project references | Share the pure contract package without adding a large monorepo framework or an extra package-manager install. |
| Client build | React + Vite | Fast browser development and static client bundle. Deploy separately from the persistent game server if needed. |
| 3D | Three.js + React Three Fiber + Drei | PRD-required Three.js rendering with React composition; procedural geometry avoids licensed-model and rigging work. |
| Pose | `@mediapipe/tasks-vision` Pose Landmarker in a Web Worker | Local inference; one in-flight frame, dropping stale frames. Do not run TensorFlow.js in parallel. Revisit only if TensorFlow is an event requirement or the hour-2 device spike fails. |
| Multiplayer | Socket.IO client/server over HTTPS/WSS | Rooms and ordered bidirectional events; acknowledgements, sequence numbers, deduplication, and snapshots provide the application-level guarantees the game needs. |
| Server | Node.js + Express + Socket.IO | One stateful process with in-memory rooms is sufficient for the demo; host must support persistent WebSocket connections. |
| Validation | Shared runtime schemas (recommend Zod) | Parse and bound every client packet; TypeScript types alone do not validate untrusted input. |
| Client state | React state for screens/forms; small external store only if needed for high-frequency snapshots | Keep per-frame pose and render transforms out of React re-render paths. Prefer refs for renderer data. |
| P0 data | In-memory authoritative match counters | Results remain available without an external service. Rooms are lost on restart, which the UI must explain. |
| P1 persistence | PostgreSQL via `pg`; Tiger Data/Timescale hypertable only if the track and credentials are confirmed | Optional async event persistence; never part of combat tick correctness. |
| P1 AI | Official Gemini server SDK/API, structured response schema | Send only approved completed aggregates; timeout, validate, cache, and keep deterministic stats visible. |
| P1 speech | Official ElevenLabs server SDK/API | Optional short narration; bounded queue, captions, mute, stale-clip dropping. |
| Quality/tooling | ESLint, Prettier, Vitest for pure shared logic, Playwright only if time permits | Fast static checks and deterministic unit coverage; prioritize combat/motion logic and a manual two-device release pass. |
| Hosting | Static HTTPS client + persistent Node service with WSS support | The client can use static hosting; the authoritative room process cannot. Choose exact host after budget/event-rule check. |

Installed for this scaffold: React/React DOM, Vite, Three.js/R3F/Drei, MediaPipe Tasks Vision, Socket.IO client/server, Express, Zod, TypeScript, ESLint, Prettier, and concurrently. The lockfile records the resolved versions. PostgreSQL/Tiger Data, Gemini, ElevenLabs, Vitest, and Playwright are intentionally deferred; add them only if their P1 work is approved after the P0 gate. The PRD does not lock API model IDs, voice IDs, or hosting vendor.

## Cross-team contracts (freeze in hours 0–2)

Developer C owns `packages/core` and publishes the first compiling contract before parallel web/motion/API implementation proceeds. Other developers consume it and do not edit it without coordinating a versioned change.

- **Seat identity:** the server assigns `A` or `B`; clients never choose or submit the opponent's identity.
- **Coordinate frames:** webcam landmarks are camera-relative; motion features are normalized and player-relative; ring world uses +Y up and X between fighters. Mirror only the preview. Avatar facing is a transform.
- **Input envelope:** `protocolVersion`, `matchId`, monotonic `sequence`, unique match-scoped `inputId`, local timestamp for diagnostics, tracking validity, guard/duck intents, clamped head offset, and optional punch hand. Connection/reconnect token binds the sender to its server-assigned seat.
- **Snapshot:** match ID, revision, server timestamp, lifecycle state, remaining active time, both HP values, defense states, scheduled attacks, and last processed input IDs. Clients render health/results only from authoritative snapshots/outcome events.
- **Combat config:** pure shared constants/curves/geometry for 100 HP, 60 seconds, symmetric 8 clean/2 blocked damage, 250/100/100 ms phases, 450 ms cooldown, and initial 30 Hz simulation. Treat detection thresholds as tuning values.
- **Motion output:** worker returns timestamped normalized features and explicit `VALID`, `LOW_CONFIDENCE`, or `LOST`; detectors emit a single punch edge and hysteretic defense states. Local practice and multiplayer share the detector through separate adapters.
- **Runtime boundary:** schemas validate socket data on receipt. Database writes, Gemini, and ElevenLabs operate from queued events after server decisions and cannot block the match tick.

## Ownership and delegated work packages

Each file has one primary owner. The names below map to PRD Developers A/B/C; substitute teammate names at kickoff.

| Owner | Owns | First deliverable | Explicitly does not own |
|---|---|---|---|
| **A — Motion** | `packages/motion/**`; `apps/web/src/cam/**`; `apps/web/src/motion/**` | Browser camera preview/cleanup, worker inference spike, normalized feature contract, calibration and detectors, diagnostics in practice | API combat rules, shared packet schemas, arena/HUD integration |
| **B — Frontend** | `apps/web/src/app/**`, `ui/**`, `game/**`, `state/**`, `styles/**` | Vite/React shell, procedural two-fighter ring, screen flow and HUD using mock snapshots/keyboard developer mode | MediaPipe worker/detector, API authority, edits to shared contracts |
| **C — Server + foundation** | `packages/core/**`; `apps/api/**`; root workspace/config; `docs/architecture.md`, `README.md`, `docs/runbook.md` | Workspace builds, packet schemas/config/pure combat, Express/Socket.IO room and authoritative match skeleton, early deploy | Web screens and avatar implementation; motion detector internals |
| **All** | No shared-file ownership; integration is coordinated by contract | Two-laptop integration, scripted P0 checks, measured performance and demo rehearsal | Do not independently edit another owner's files; route fixes to owner or agree on handoff first. |

Developer C is the critical path and receives help from A/B on optional integrations only after the complete P0 flow passes. For delegated implementation, dispatch only after teammates are available; this plan's independent PRD reviews were delegated to motion, frontend, and server reviewers and are folded into this ownership map.

## 24-hour sequence and gates

| Time | Work | Gate / decision |
|---|---|---|
| **Before / 0–2h** | Check event prework and sponsor rules, browser/camera availability, API credentials/quotas, hosting budget. Freeze packet/action contracts. A proves MediaPipe worker landmarks on intended laptops; B renders a moving primitive arm and ring; C deploys empty client/server and completes socket round trip. | If camera inference or 3D performance is untenable, choose lighter settings/model immediately. No feature work until the three spikes are demonstrated. |
| **2–5h** | A implements normalization, calibration, punch/guard/duck detectors and confidence diagnostics. B builds arena, procedural robots, authored action animations, HUD/countdown and developer keyboard controls. C builds room lifecycle, authoritative fixed-tick combat, validation, deduplication, snapshots, results. | Keyboard-driven multiplayer match finishes with same server-owned result on both clients. |
| **5–8h** | Integrate real webcam controls, tracking pause/resume, reconnect flow, and provisional local animation against the frozen contract. | One device punches; opponent sees synchronized health loss; guard reduces damage; duck causes a miss; server declares result. If this fails, all hands fix P0. |
| **8–12h** | Tune across all teammates and both laptops. Exercise tracking loss, hidden tab/camera stop, disconnect/reconnect, duplicate/stale inputs, simultaneous attacks, timeout, rematch and resource cleanup. Polish readable effects and recovery messages. | Three clean consecutive full P0 matches. Freeze P0 scope here. If it fails, defer every sponsor integration. |
| **12–16h** | P0 polish first. Then C adds async Tiger Data event persistence and results visualizations only if available and the gate remains green. | Query at least one completed persisted match; DB outage leaves in-memory result usable. Otherwise spend this block on P0 polish. |
| **16–19h** | Only while P0 continues passing: add Gemini analysis and ElevenLabs optional announcements behind isolated adapters. | Each has timeout/error handling; analysis is validated and grounded in metrics; voice can mute and clips cannot overlap. Remove unstable integration from demo. |
| **19–21h** | Deploy to intended URLs/network; test on actual two laptops with inference active; capture FPS/inference/RTT and setup time; confirm cache paths, secrets, camera teardown, and reconnect. | Release checks pass on the exact judging setup; record actual values rather than claiming targets. |
| **21–24h** | Freeze functionality. Fix only blockers, prepare credits/setup/submission, capture clearly labeled backup footage, rehearse one-minute demo. | No new P2 features; preserve packaging and rehearsal time. |

## Work-package detail and handoffs

### A — Webcam and motion

1. Acquire camera only after explicit setup choice; enumerate/select device; show mirrored local preview; release all tracks and inference resources when leaving.
2. Load matching local MediaPipe model/WASM in a worker. Process one frame at a time and drop stale frames; expose inference rate/duration and tracking validity.
3. Implement 3-second neutral calibration for shoulder width, torso/head baseline, arm proportions, and jitter. Require one successful sample of each supported action before Ready. Keep the baseline fixed during action; adapt slowly only in neutral stance.
4. Normalize aspect-corrected coordinates and timestamps. Implement punch one-shot/rearm/cooldown plus guard/duck hysteresis and attack/defense exclusivity. Clear history after long gaps.
5. Feed `PracticeAdapter` or `SocketInputAdapter`; never export frames, audio, or raw pose history. Ship confidence and detected-action diagnostics to practice UI.

**Handoff:** normalized features and controls are versioned in shared types; detector accepts fixture inputs without camera. A supplies B a stable hook for tracking and action status, and supplies C only the declared control envelope.

### B — Browser experience and 3D

1. Create landing → lobby → setup → calibration → practice → fight → results flow with actionable permission/model/WebGL/network errors.
2. Build fixed three-quarter ring and procedural robots with shoulder/elbow parent groups, clear glove/team labels, authored punch/guard/duck animations, simple lighting, and bounded pose offsets.
3. Keep renderer updates on the render loop with refs/lightweight state; interpolate cosmetic remote data only. Health, clock, and outcomes come from server snapshots. Reconcile provisional punch animation when rejected.
4. Build responsive DOM HUD: health, round clock, connection/tracking status, hideable preview, HIT/BLOCK/MISS feedback, settings, results and rematch consent. Add keyboard mode visibly labeled developer-only.
5. Respect reduced motion, keyboard navigation, contrast, captions/mute, and visible color-independent player labels. Cap pixel ratio at 1.5; degrade effects before dropping Three.js.

**Handoff:** B consumes snapshots and lifecycle events, calls A's motion adapter, and does not duplicate combat decisions in UI. Practice may use a local adapter over the same combat config.

### C — Shared foundation, server, and deployment

1. Create workspace and core runtime schemas/constants first. Publish stable interfaces; establish scripts for dev/build and an early deploy.
2. Implement room-code generation/rate limiting/expiry, exactly two seats, connection-bound identity, lifecycle states, ready/calibrated/tracking checks, reconnect tokens and disconnect abandonment.
3. Implement deterministic 30 Hz combat: validate intent, sequence and IDs, enforce cooldown/phase timing, resolve canonical sweep/guard/duck, queue same-tick damage, clamp HP, settle timer/KO/draw once, and accumulate authoritative counters.
4. Publish full snapshots at 20 Hz plus immediate lifecycle/combat messages; handle explicit acknowledgements and bounded retries for punches. Control stream coalesces obsolete samples.
5. Expose health/readiness and developer diagnostics; configure HTTPS/WSS origin allowlist and secrets via server env only. Document startup, env vars, deploy, restart behavior and demo recovery.
6. After the P0 gate, add PostgreSQL/Tiger Data, Gemini, ElevenLabs as bounded async adapters with per-service unavailable states and usage caps.

**Handoff:** send B/A the protocol examples and local server URL as soon as the room echo works. Integration does not wait for optional services.

## Verification checkpoints

The PRD's quantitative targets are acceptance goals, not established performance. On actual demo hardware, record sample counts and environment for: 17/20 punches per hand; ≤1 false punch in 30 s idle/guard; ≥8/10 guard and duck; ≥30 FPS while inference runs; ≥15 inference samples/s; local action-to-animation p95 <120 ms; socket acknowledgement RTT p95 <250 ms. Do not conflate local latency, inference delay, and network RTT.

At minimum, use the PRD's release checklist: scripted motion trials (including mirrored preview, distance, low light, occlusion, tracking gap), deterministic combat scenarios (one outcome, cooldown, chip/block, duck miss, bounds, duplicate/stale input, inactive match, timeout, double KO, pause), multiplayer races/reconnect/tab/camera loss/restart, two-device visual and rematch cleanup, and optional-service outage/malformed response/mute checks. Record failures and fixes; never report a target as met without measurements.

## Scope decisions and risks to resolve before implementation

These are PRD-confirmed gates; the defaults below keep planning moving, but the team must verify the external facts before relying on them:

- **Event/prework/sponsor rules:** verify before counting any pre-event preparation or advertising a sponsor-track integration. Default: no eligibility claims until checked.
- **Hosting and budget:** confirm a stateful Node/WebSocket host, public HTTPS URL, and budget. Default: one server process and in-memory rooms; server restart expires rooms.
- **Demo devices/browser:** verify latest stable desktop Chrome/Edge and cameras on both laptops. Default: test only these desktop browsers for the prototype.
- **Computer-vision requirement:** confirm whether MediaPipe meets the event brief. Default: MediaPipe only; do not add TensorFlow.js as a second pipeline.
- **P1 credentials/quotas:** confirm Tiger Data, Gemini, and ElevenLabs access and spending limits. Default: all optional and excluded from P0; graceful unavailability is acceptable.
- **No ranked anti-cheat:** clients can fabricate plausible controls even with authoritative health. Describe this as an unranked prototype, not proof of real physical movement.

Primary risks are punch foreshortening, inference/render contention, remote latency fairness, and optional integrations consuming P0 time. Preserve the explicit hour-12 gate, procedural models, bounded frame processing, visible connection quality, and Three.js as mandatory.

## Later roadmap (excluded from this plan's implementation scope)

P2 includes hooks/uppercuts/slips, stamina, free movement, configurable rounds, avatar selection/rigged GLTF, match history, ghost replay, additional games, distributed server scaling and competition-grade anti-cheat. Re-scope these only after post-hackathon user validation.
