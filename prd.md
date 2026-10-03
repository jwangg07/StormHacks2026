# WebcamBoxer Product Requirements Document

Version 1.0 | October 3 2026 | Planning baseline for a three person team

## 1 Product decision and summary

Build a browser multiplayer boxing game in which each player uses a webcam to control a stylized 3D fighter. Players throw left and right punches, raise a guard, and duck to avoid attacks. Three.js renders the arena and fighters. A shared server resolves combat and publishes the same health, timer, and winner to both clients.

The first release is a 24 hour hackathon prototype. Its release criterion is a reliable two laptop match with camera input, understandable combat, and a polished 3D presentation. Analytics, Gemini coaching, and ElevenLabs narration are subsequent priorities within the same build. This document specifies the product experience and proposed implementation decisions; all numerical thresholds are initial tuning values or acceptance targets, not measured results.

Working name: WebcamBoxer. Audience: the three developers implementing the prototype and judges evaluating the demo. Scope assumption: two remote players, one webcam per player, desktop browsers, one 60 second round, and no accounts. Hosting and sponsor eligibility remain to be verified against the actual event rules.

## 2 Problem and value

Friends should be able to play an expressive movement game remotely with hardware they already own. Conventional browser games primarily use keyboards and mice; controller and VR experiences introduce additional hardware. WebcamBoxer lets people join a room and physically control a fighter using a laptop camera.

The product should feel responsive and readable even when tracking is imperfect. Successful play depends on attack timing and defensive movement, rather than measured punching strength. The game is an entertainment prototype; analytics describe detected motions and game outcomes rather than certified boxing technique.

Primary user: a casual player with a laptop, webcam, and enough space to extend their arms. Secondary user: a friend joining remotely. Demo user: a judge who should understand the controls after a short practice sequence. Developer user: a teammate tuning detection with visible confidence and action diagnostics.

The primary user story is: As a player, I want to join a friend using a room code and see my physical punches, guard, and duck reflected in a 3D fight so that I can play without a controller. Supporting stories cover permission recovery, practice before a match, visible tracking feedback, fair defensive reactions, and a clear final result.

## 3 Goals and success measures

G1 Deliver one complete multiplayer match using only webcam input after lobby setup. G2 Make physical actions produce immediate local visual feedback. G3 Make server outcomes consistent across both devices. G4 Produce a one minute live demonstration with a punch, block, duck, and result. G5 Explain the engineering through local pose inference, action classification, authoritative combat, and optional event analytics.

Proposed acceptance targets on the two actual demo laptops: room join and calibration completed within 90 seconds after assets load; at least 17 of 20 deliberate punches detected for each hand; no more than one false punch during 30 seconds of idle and guard movements; at least 8 of 10 deliberate guard and duck trials recognized. Test across all three teammates and repeat with the venue lighting.

Performance targets: rendering at least 30 FPS with pose inference active; inference at least 15 samples per second; local action to visible animation at p95 below 120 ms; server input acknowledgement RTT at p95 below 250 ms on the demo network. Record the environment and sample counts. These are separate measurements: local responsiveness must not be confused with network or inference latency.

Reliability target: three consecutive full matches with identical health and results on both clients, no duplicate damage, no crashes, and correct recovery from a tracking interruption. Setup errors must present a useful next action. Optional API failures must not interrupt a fight.

Outside scope: realistic impact physics, calibrated force or speed, hooks and uppercuts, free movement around the ring, ranked matchmaking, anti-cheat suitable for competition, payments, mobile support, long term accounts, medical or fitness advice, video streaming, a universal motion game engine, and fully rigged realistic humans.

## 4 Scope and priority

P0 means required to ship. P1 means add only after a complete P0 match passes. P2 means future work. Three.js is P0 and must remain in the MVP even if other features are removed.

P0 features: create and join a two player room; camera permission and model loading; calibration and practice; left punch, right punch, guard, duck; two procedural 3D avatars; ring and fixed camera; authoritative combat; 100 HP and a 60 second clock; countdown and winner or draw; tracking pause and disconnect handling; mute and motion effects settings; basic results counts; keyboard controls restricted to a clearly labeled developer mode.

P1 order: persistent combat event analytics through Tiger Data; results visualizations; concise Gemini analysis grounded in metrics; ElevenLabs narration and voiced coaching. Add polish to P0 before implementing the last integration. A future submission can target sponsor tracks only for integrations actually working.

P2 features: side slips, hooks, uppercuts, stamina, configurable rounds, avatar selection, skeletal GLTF models, match history, ghost replay, custom gesture classifiers, and additional games. Implementing any of these requires a new scope decision after the hackathon.

## 5 User journey and screens

Landing: show the game name, a brief explanation, Create Room and Join Room, browser compatibility guidance, and a statement that camera frames remain on the device. Camera permission is requested only after the player chooses setup. Names are optional and limited to 20 plain text characters.

Room lobby: display a six character room code, copy action, two player slots, connection status, and a Ready control. A third participant receives Room full. Invalid or expired codes receive a specific error. Empty rooms expire after ten minutes. Room codes use an unambiguous random alphabet and creation is rate limited.

Camera setup: show a mirrored local preview, camera selector, loading progress, and an upper body framing outline. Explain that shoulders, elbows, wrists, and head should remain visible. Permission denied offers browser permission guidance and Retry. Missing camera, occupied camera, failed model fetch, and unsupported rendering each have separate messages.

Calibration: ask the player to hold a neutral stance for three seconds. Collect shoulder width, torso reference, neutral head height, arm segment proportions, and baseline jitter. Then prompt left punch, right punch, guard, and duck with visible recognition checks. Ready becomes available only after a valid baseline and one successful example of each action. Allow recalibration and sensitivity adjustment in practice.

Practice: animate the local fighter opposite a passive dummy. Display detected action and tracking status. The purpose is to learn whether actions register before joining a live fight. Practice uses the same action detector and combat configuration as multiplayer, with local simulation behind an adapter.

Fight: use a fixed three quarter side view of two fighters facing each other. DOM overlays display names, health, clock, connection and tracking status, a compact camera preview that can be hidden, and short HIT, BLOCK, or MISS feedback. Show a 3 2 1 countdown, then enable attacks. Distinguish fighters through blue and orange gloves plus labels, not color alone.

Results: display winner or draw, final health, duration, punch attempts, clean hits, blocks received, misses, and rematch. If P1 ships, add a short activity timeline, left and right usage, defensive counts, and AI analysis with loading and unavailable states. Both players must choose rematch; the server resets state and runs a new countdown.

## 6 Functional requirements and acceptance

FR01 Room integrity P0. The server assigns exactly two player seats and binds input to the assigned connection. Acceptance: simultaneous joins cannot create a third seat, and a user cannot submit input for the opponent.

FR02 Local camera processing P0. Frames are processed locally; no video or audio capture is transmitted. Acceptance: inspecting network traffic finds normalized control data and game events, with no webcam frames. Close media tracks and inference resources when leaving setup or a room.

FR03 Calibration P0. Baselines account for body scale and screen orientation. Acceptance: moving closer within reasonable framing does not systematically amplify game damage; left hand remains left hand even with a mirrored preview.

FR04 Action recognition P0. Emit one action per deliberate punch and continuous guard and duck states with hysteresis. Acceptance: holding an extended arm does not repeat damage; lowering arms releases guard; tracking jitter does not repeatedly toggle defense.

FR05 3D representation P0. Both fighters react to punches and defense with visible animation, and the ring remains readable. Acceptance: every supported action is visually identifiable from the judge viewing position, and no external character model is needed for the build to run.

FR06 Combat authority P0. Health and outcomes originate on the server. Acceptance: a modified client health value does not affect the opponent or final result; duplicate input IDs cannot cause duplicate hits.

FR07 Match lifecycle P0. Both players must be connected, calibrated, tracking, and ready. Acceptance: attacks before the start or after finish do nothing; timeout uses health to determine the winner; equal health is a draw; zero HP ends the match once.

FR08 Fault handling P0. Tracking or network loss pauses the fight for both players and explains why. Acceptance: a tracked player cannot damage an opponent while tracking is lost; resuming requires fresh tracking and confirmation; disconnect timeout follows Section 10.

FR09 Results P0. Aggregate accepted server combat outcomes. Acceptance: attempts equal hits plus blocks plus misses for each player; rejected inputs are excluded; rematch starts from 100 HP with fresh counters.

FR10 Analytics persistence P1. Save combat events asynchronously without delaying combat. Acceptance: a completed match can be queried by match ID; database failure displays persistence unavailable while the in memory results remain usable.

FR11 AI analysis P1. Generate a structured summary using completed match aggregates. Acceptance: each statistical claim can be traced to a provided metric; output is validated and safely rendered; unsupported statements are omitted.

FR12 Audio P1. Narration is optional and never blocks combat. Acceptance: mute works immediately, clips do not overlap, stale commentary is discarded, and narration failures leave text feedback intact.

## 7 Motion processing specification

Recommended inference provider: MediaPipe Pose Landmarker through @mediapipe/tasks-vision, VIDEO mode, one person, with segmentation disabled. MediaPipe is the selected ML component; TensorFlow.js is not a separate required dependency. If an actual TensorFlow requirement exists, evaluate a TensorFlow.js pose detector as a replacement during the first spike rather than run both pipelines. [1]

Use the nose, shoulders, elbows, wrists, and visible hips. Reject relevant landmarks below an initial visibility threshold of 0.6. Store a short timestamped history of approximately 300 ms. Convert normalized image coordinates into aspect corrected coordinates before distances or angles are computed; otherwise a wide webcam frame distorts geometry. Image y increases downward, so ducking moves head and shoulders toward greater image y.

Normalize motion using calibrated shoulder width. Keep the calibration baseline stable during an action; slowly update it only in a valid neutral state. Estimate wrist velocity from timestamp differences, not frame count. Apply light exponential smoothing and separately measure whether it delays punches. Clear motion history after a long gap to avoid a false velocity spike.

Punch detector: begin armed while the wrist is near its resting region and the elbow is bent. Trigger on a rising extension motion with sufficient normalized wrist speed and elbow angle change. Initial candidates: wrist speed above 1.5 shoulder widths per second and elbow angle increasing at least 25 degrees within 250 ms. These values are tunable. Use estimated depth only as supporting evidence; a front facing webcam can obscure wrists during a straight punch.

After a trigger, enter a 450 ms shared punch cooldown. Require the active wrist to return toward the rest region before that hand rearms. The server also enforces the cooldown. Both hands triggering simultaneously produce one attack selected by stronger detection confidence, then fixed tie breaking. No damage multiplier uses inferred real world speed in P0.

Guard detector: both wrists lie within an initial 0.8 shoulder widths of the head and elbows are visibly bent. Enter after approximately 100 ms of consistent evidence and exit after approximately 150 ms outside the zone. Tune the region for different arm proportions. Valid guard is disabled during the player's attack and recovery window.

Duck detector: head and shoulders move down by an initial 0.35 calibrated shoulder widths while remaining visible. Require approximately 100 ms of consistent evidence; exit with a smaller threshold to prevent flicker. Combine head and shoulder motion to avoid treating a head nod as a duck. Maximum sustained duck is 800 ms, followed by 400 ms rearm after returning toward neutral, so remaining crouched cannot grant permanent immunity.

Tracking validity: expose VALID, LOW_CONFIDENCE, and LOST. Freeze at the last safe visual pose for at most 200 ms during a transient drop, never create attacks from low confidence frames, and pause the shared match after 500 ms of invalid tracking. A voluntary camera stop or hidden tab signals a pause immediately. Resume only after one second of valid tracking and player confirmation.

Capture guidance: use a comfortable slight angle if front on punches obscure the wrist. Test the framing at setup. Gestures are game inputs; the tutorial should encourage small controlled motions and enough room to extend arms. Seated play and sensitivity profiles are future improvements unless validated during the prototype.

## 8 Three.js frontend requirements

Use React, TypeScript, Vite, Three.js, React Three Fiber, and Drei. React Three Fiber provides the React renderer for Three.js; it does not replace Three.js. Use ordinary React DOM for forms, health bars, settings, and results. Pin a mutually compatible stable dependency set in the lockfile when scaffolding. [2]

The MVP fighter is a procedural robot made from a torso mesh, head sphere, articulated capsule arms, gloves, and simple anchored legs. Construct parent groups at shoulder and elbow joints. This avoids importing a humanoid rig or implementing full body inverse kinematics within 24 hours. A fixed ring, floor, ropes, and simple lighting establish the scene. Add a licensed GLTF character only as P2.

Player pose controls bounded torso lean, head height, and the resting glove position. Recognized punches trigger authored animation curves that extend the glove toward the opponent and return it to guard. Guard raises both gloves; duck lowers the head and torso. Ground truth for collisions is the server's canonical animation and hitboxes, not arbitrary raw webcam wrist positions in a shared 3D space.

Coordinate contract: webcam coordinates are camera relative; normalized gameplay head offsets are player relative; ring coordinates use world y as up and world x along the fighter to fighter axis. Player A faces positive x and Player B faces negative x. Apply mirroring only to the displayed camera preview; swap ring facing through avatar transforms, never through landmark labels. Clamp torso and head offsets to a defined gameplay envelope.

Rendering runs independently of inference. Read latest pose and authoritative snapshot from refs or a lightweight store. Update transforms in the render loop with elapsed time rather than driving React state for each landmark. Reuse vectors, geometries, and materials; dispose owned GPU resources on teardown. Interpolate remote cosmetic pose snapshots with a short initial buffer around 80 ms. Avoid extrapolating attacks that have not been accepted. [3]

Start with one inexpensive lighting setup, capped device pixel ratio at 1.5, no postprocessing, and optional shadows off. If render performance falls below target, reduce pixel ratio, disable shadows and particles, and decrease inference frequency while maintaining at least 15 Hz on the demo machines. Cache model and WASM assets locally in the build and verify loading before the demo.

Visual polish priorities: glove trails, short hit flashes, clear damage indicators, readable health bars, and a small optional camera shake. Reduced motion disables shake and strong flashes. Audio begins only after user interaction. If WebGL rendering fails, show a compatibility error and retry instead of presenting a blank screen.

## 9 Combat rules and balance

Initial match configuration: 100 HP each, 60 seconds of active play, fixed range, head attacks only, no stamina, and no movement around the ring. Left and right punches each deal 8 damage on a clean hit and 2 damage when blocked. Use symmetric values until calibrated motions and latency are reliable. Preserve hand identity without labeling every left hand action a jab for all stances.

Every accepted punch has a 250 ms windup, 100 ms active window, and 100 ms recovery. The 450 ms cooldown limits spam. Broadcast attack scheduled time immediately so the defender can see it developing. The match server is the source of phase timing; the client can begin a provisional local windup but only confirmed outcomes change health.

At a fixed initial 30 Hz simulation tick, evaluate the canonical glove sweep against the opponent head hitbox. A valid duck moves the head below the swept strike region. A valid guard intercepts an otherwise colliding head strike. Resolve each attack at most once: miss if there is no collision, block if there is collision and effective guard, otherwise clean hit. Swept collision prevents a fast glove from passing through a hitbox between ticks.

Set the ring distance and authored reach so an upright neutral defender is within attack range. Client and server share dimensions and animation curves through a pure shared package. Do not derive attack reach from how tall the player is or how close they stand to the camera. During windup through recovery, the attacker cannot simultaneously claim guard; ducking during attack is also disabled in P0.

Defense is determined from the latest valid server received control state at the simulation tick. No latency rewind is included in P0. Display connection quality because this policy favors stable low latency connections. Queue same tick damage and apply it simultaneously so a double knockout can produce a draw. HP remains between 0 and 100. At the deadline, do not accept new attacks or apply later scheduled hits.

Holding guard reduces but does not eliminate damage. Timed duck limits discourage permanent evasion. Balance is considered adequate if all three demo gestures have a clear visible effect and neither idle guarding nor repeated identical punches makes the match unreadable. Ranked fairness is a later requirement.

## 10 Multiplayer and state management

Use Node.js, TypeScript, Express, and Socket.IO. Run one stateful server process for the hackathon with in memory rooms. Use a host that explicitly supports persistent Socket.IO connections; do not assume a static frontend deployment can run the game server. Production requires HTTPS for the client, an encrypted socket connection, and an explicit origin allowlist.

Room lifecycle: LOBBY, CALIBRATING, READY, COUNTDOWN, ACTIVE, PAUSED, FINISHED, CLOSED. Countdown starts only when both players are ready and tracking is valid. Pausing cancels outstanding attacks, freezes active round time, and clears prediction. Resume uses a short shared countdown; cooldowns reset safely. Repeated voluntary pauses are acceptable for a prototype and unsuitable for ranked play.

Client control packets contain protocolVersion, matchId, sequence, a session scoped input ID, local monotonic timestamp, tracking status, guard and duck intent, clamped head offsets, and optional left or right punch intent. The server authenticates the player using the connection and reconnect token; it does not trust a claimed player ID. Client timestamps support diagnostics, not damage ordering.

Send latest control and cosmetic pose at 15 to 20 Hz, coalescing obsolete samples. Send punch intent immediately with acknowledgement. Use sequence numbers for stale control rejection, unique input IDs for duplicate rejection, and bounded retry for attacks. Socket.IO provides ordered messages but defaults to at most once delivery; explicit acknowledgements and deduplication are necessary for critical inputs. [4]

Server snapshots contain matchId, revision, server timestamp, state, remaining active time, both HP values, defense states, scheduled attacks, and last processed input IDs. Broadcast at 20 Hz plus immediate combat and lifecycle events. Clients render health only from these snapshots and reconcile provisional animation if the server rejects an input.

Initial guardrails: validate packet schemas, reject nonfinite values, clamp coordinates, cap control packets at 30 per second per client, enforce attack cooldown, limit packet size to 4 KB, and reject mismatched match IDs or reused input IDs. Bound deduplication history to the current match. Store tokens in memory and never log them. This limits malformed input and spam; clients can still fabricate plausible motion, so the prototype is unranked.

Disconnect: immediately pause and allow ten seconds for reconnection with a server issued session token. A reconnect receives a full snapshot and fresh tracking calibration if required. Discard buffered predisconnect attacks. If a player fails to return, end as abandoned with no competitive winner. Tracking that remains invalid for 20 seconds also abandons the match. Server restart loses active rooms and explains that the room expired.

## 11 Analytics and AI requirements

P0 results use in memory authoritative counters. Attempts count accepted attacks; outcomes partition attempts into clean hits, blocked attacks, and misses. Clean hit rate equals clean hits divided by attempts. Display No attempts when the denominator is zero. Defensive blocks count attacks blocked by the player. A successful duck requires an otherwise colliding attack to become a miss while effective duck is active.

P1 analytics include left and right attempt counts, clean hit rate, successful blocks and ducks, HP over time, attack activity in five second buckets, and tracking pause duration. Motion intensity can be reported in shoulder widths per second with an Estimated label. Do not label webcam estimates as calibrated meters per second or infer punching power.

Reaction time is excluded from the MVP. A later version would need to log the time the attack cue was actually presented on the defender device and the first defensive response using the same local monotonic clock. Server receipt times alone confound reaction with network delay.

Tiger Data integration: retain server combat events as the authoritative dataset, with an optional downsampled pose feature stream at 5 Hz for timelines. Batch inserts in the background every second or after a bounded batch size. Use an event hypertable if the integration ships; time partitioning supports time series event queries. Avoid claiming that this small prototype requires database scale. [5]

Proposed schema: matches stores id, creation and start and end times, status, final HP, winner seat, config version, and persistence status. Participants stores match ID, seat, pseudonymous session ID, and sanitized display name. Combat events stores event time, event ID, match ID, attacker seat, defender seat, hand, outcome, damage, and simulation tick. Pose features stores event time, match ID, seat, normalized wrist speed, head offset, guard, duck, and tracking confidence. For hypertables, include the partition timestamp in any unique event key.

Retention proposal: combat results seven days; optional pose features 24 hours; no webcam frames. Allow analytics opt out before the match. If either participant opts out, skip persistence and AI export for that match while retaining temporary in memory results. Communicate the retention period in setup and provide session scoped deletion while the demo server is available.

Gemini coaching P1: send only completed aggregate metrics and approved derived observations, excluding names, frames, and raw pose history. Request three fields: strength, improvement, suggested in game strategy, plus supporting metric keys. Validate structured output and restrict displayed length to approximately 100 words. Do not infer technique defects, fatigue, injuries, or dropped guard unless the corresponding evidence is actually recorded. [6]

Cache one analysis per match and seat. Timeout after eight seconds and show Analysis unavailable with a manual retry; keep deterministic stats visible. Generate at most one successful analysis per player per match under normal use. The system prompt treats all display names or user strings as data rather than instructions.

ElevenLabs P1: generate or stream short lines for round start, first clean hit, a notable streak, low health, finish, and voiced analysis. Prefer cached narration for fixed announcements. During a fight, use deterministic event templates; Gemini generated live commentary is P2. Queue at most two clips, prioritize finish, suppress routine lines within five seconds of another, and drop fight commentary more than two seconds stale. Captions show the same text. [7]

Keep Gemini and ElevenLabs credentials exclusively on the server. Cap AI requests per match and per session, and add configurable hard spending or usage limits. Choose models and voices available to the team at build time; this PRD does not promise a particular paid tier or API latency.

## 12 Architecture and engineering boundaries

Client pipeline: webcam to inference worker to normalized feature history to action detector to input adapter. The adapter feeds local practice or Socket.IO multiplayer. Three.js consumes pose and combat snapshots. DOM UI consumes lifecycle and results state. Raw frames remain within the client inference boundary.

Server pipeline: validated input to fixed tick combat simulation to snapshots and combat events. Async analytics and optional AI or voice workers consume events after combat decisions. Database writes, Gemini calls, and speech generation must never be awaited inside the simulation tick.

Suggested repository modules: apps/client for React UI and Three.js; apps/server for room lifecycle and simulation; packages/shared for packet schemas, constants, animation curves, and pure combat geometry; packages/motion for normalization and gesture state machines. This is an organization suggestion, not a requirement to add a complex monorepo toolchain.

Frontend dependencies: react, typescript, vite, three, @react-three/fiber, @react-three/drei, @mediapipe/tasks-vision, socket.io-client, a schema validator, and optional lightweight state store. Server dependencies: express, socket.io, shared schema validation, and pg for P1 persistence. Use current official SDKs for Gemini and ElevenLabs only if the corresponding integration is selected.

The pose worker owns inference lifetime and processes one frame at a time. Drop stale pending frames instead of queueing an inference backlog. The renderer owns GPU assets and animation. The detector owns gesture state. The server owns room state, accepted actions, combat, and result metrics. The database stores history, with no role in resolving the current match.

Expose a health endpoint and readiness checks. Diagnostics record render FPS, inference frequency and duration, input acknowledgement RTT, tracking validity, rejected input reason, server tick drift, and integration status. Keep these behind developer controls; never expose secrets or raw frames. Degrade visual effects before abandoning the Three.js requirement.

## 13 Nonfunctional requirements

Compatibility: latest stable desktop Chrome or Edge on the two demo laptops is the initial support target. Firefox and Safari are unverified until tested. A webcam and a supported WebGL context are required. Test actual hardware, not only a development desktop. Model and WASM versions must match and be served with correct asset paths.

Accessibility: keyboard navigable setup, readable contrast, labels alongside colors, captions for narration, mute, reduced motion, adjustable detection sensitivity, and clear errors. The initial game still requires arm and upper body movement; do not claim universal physical accessibility. Developer keyboard mode provides testing coverage, not an equivalent public game mode.

Privacy and security: explicit permission, local camera inference, minimal normalized data transfer, no video recording, temporary room identities, retention disclosure, and server side secrets. Render names as escaped text. Restrict CORS and socket origins to configured clients. Do not put service keys in Vite public environment variables or logs.

Reliability: asynchronous optional features, bounded queues, timeouts, result caching, and full state snapshots after reconnect. If persistence fails, show temporary results with a clear unavailable state. If audio or analysis fails, preserve the match and results. Do not fabricate saved history or AI output as a fallback.

Capacity: demo deployment targets five simultaneous rooms, subject to a brief synthetic test. This is an engineering target rather than a verified production capacity. A single process deployment requires no distributed room coordination; scaling across instances is P2 and would need sticky routing and shared state or room ownership.

## 14 Development plan for 24 hours

Before the clock if event rules allow: install dependencies, confirm camera access, obtain API credentials, verify host support, and inspect asset licenses. If prework is prohibited, perform these checks in hour zero. Do not count prebuilt application code as permitted without checking the rules.

Hours 0 to 2: agree on packet and action interfaces; run camera inference on the intended laptops; render two primitive fighters in Three.js; connect two clients to a room; deploy an empty client and server early. Gate: valid landmarks, moving 3D arm, and a round trip socket message. If tracking performance fails, choose a lighter pose model immediately.

Hours 2 to 5: motion owner builds normalization, punch and defense state machines, and practice diagnostics. Frontend owner builds ring, authored punch animations, health HUD, and countdown with keyboard test inputs. Server owner implements shared combat rules, room states, deduplication, and snapshots. Gate: a keyboard driven match completes with consistent results.

Hours 5 to 8: integrate camera controls and real multiplayer using the shared contract. Gate: one laptop punches, the opponent loses health, guard reduces damage, duck causes a miss, and the server declares a result. Prioritize fixing the entire flow before adding analytics.

Hours 8 to 12: test calibration across the team, tracking loss, disconnects, duplicate inputs, simultaneous attacks, and timer behavior. Tune gestures and 3D feedback. Gate: three clean full matches. Freeze P0 scope here; if the gate fails, postpone all sponsor integrations and keep working on P0.

Hours 12 to 16: polish P0 and implement Tiger Data event persistence plus analytics if the core is stable. If the event does not offer the relevant database track, use in memory results and prioritize polish. Gate: results match authoritative events and a saved match can be queried when persistence is enabled.

Hours 16 to 19: implement Gemini aggregate analysis and ElevenLabs announcements in parallel with final UI work only if P0 continues passing. Gate: both have timeout, mute or retry, and unavailable states. Remove any unstable integration from the visible demo rather than let it break the match.

Hours 19 to 21: test the deployed build on two laptops at the venue; cap quality settings, verify asset caching, and record measured targets. Rehearse live gestures. Gate: all P0 release checks pass using the same URLs and network intended for judging.

Hours 21 to 24: freeze functionality, fix only blocking issues, record a clearly labeled backup demo, prepare the submission and credits, and rehearse the one minute pitch. Protect time for packaging rather than adding hooks, stamina, or realistic avatars.

Ownership: Developer A owns pose worker, calibration, normalization, and action detection. Developer B owns React UI, Three.js arena, avatar animation, feedback, and results presentation. Developer C owns server, shared combat, deployment, persistence, and API integrations. All three own two device integration checks; Developer C receives help on optional integrations only after each person's P0 work is stable.

## 15 Verification and release checklist

Motion verification: collect scripted idle, left punch, right punch, guard, and duck sequences from all teammates. Track true detections, missed detections, duplicates, and false positives. Repeat with a mirrored preview, changed camera distance, low light, partial wrist occlusion, and a brief lost tracking interval. Use sanitized feature fixtures for repeatable detector tests without retaining webcam video.

Combat verification: deterministic unit tests cover one attack one outcome, shared cooldown, guard damage, duck miss, bounded HP, stale and duplicate inputs, no damage outside active play, timeout, simultaneous knockout, and pause canceling pending attacks. These tests protect state integrity rather than mirror UI implementation.

Multiplayer verification: test simultaneous room joins, third player rejection, reconnect token recovery, abrupt tab closure, camera shutdown, hidden tab pause, and server restart. Simulate moderate delay and loss; confirm provisional animation cannot change authoritative health. Confirm outcomes converge after a full snapshot.

Visual verification: inspect framing on both actual screens, confirm HUD does not obscure fighters, verify left and right animation correspondence, test reduced motion and mute, and check repeated rematches for GPU or worker resource leaks. Validate FPS with inference and network active, not in an empty scene.

Integration verification P1: stop the database, expire API access, return malformed analysis, delay speech, and mute during playback. Combat must continue or finish normally; the results screen must accurately identify unavailable services. Compare every displayed percentage to the stored event totals.

Ship checklist: all P0 functional acceptance checks pass; measured demo hardware targets are recorded; three deployed matches succeed consecutively; service keys are absent from the client bundle; camera tracks stop on exit; results agree on both devices; repository instructions cover startup and environment variables; assets have credits; submission names only features actually demonstrated.

## 16 Risks and decisions

R1 Straight punches are hard to detect from a front camera due to foreshortening. Mitigation: short calibration trials, a slight angle option, supporting elbow geometry, and accepting only two punch types. Decision gate: if one hand fails the detection target by hour five, tune the gesture before adding anything else.

R2 Inference competes with 3D rendering. Mitigation: worker inference, lighter model, bounded frame processing, lower pixel ratio, and simple geometry. Preserve Three.js and reduce visual effects first.

R3 Remote delay makes defensive actions feel unfair. Mitigation: explicit windup, visible connection quality, immediate local feedback, and server authority. No rewind is promised. If delay is unacceptable, use the same nearby network for the demo and disclose remote testing limits.

R4 Realistic avatar work consumes the hackathon. Mitigation: procedural robots and authored animations as P0. Full skeletal retargeting stays P2.

R5 Sponsor integrations consume core development time. Mitigation: mandatory hour twelve core gate and independent failures. Eligibility requires checking the actual event challenge rules; previous examples from other hackathons are not proof of eligibility.

R6 Permanent guard or duck weakens gameplay. Mitigation: chip damage, attack and defense exclusivity, bounded duck duration, and small tuning sessions. Add stamina only in a future release.

R7 A client fabricates inputs. Mitigation: validate bounds and rates, enforce server rules, and identify the demo as unranked. Do not claim server authority alone proves a physical gesture happened.

## 17 Tracks and demonstration

Candidate Best Game: the main submission story is a playable browser fighting game controlled by physical motion. Candidate Best Design: readable 3D feedback, rapid onboarding, and clean match UI. Candidate Sports Analytics: require actual detected motion and combat metrics with truthful measurement units; a boxing theme alone is insufficient.

Candidate Tiger Data challenge: require stored time stamped combat or pose events and a working query backed results view. Candidate Gemini challenge: require demonstrated analysis grounded in actual completed match metrics. Candidate ElevenLabs challenge: require audible integrated announcements or coaching with caption and mute support. Surge Choice or overall categories depend on the event's official rules. These are proposed mappings from the earlier discussion, not verified current tracks or guaranteed eligibility.

One minute demo: seconds 0 to 8 explain the product and show two ready players; 8 to 20 throw one clear punch and show synchronized health loss; 20 to 32 raise guard and show reduced damage; 32 to 44 duck and show a miss; 44 to 52 show finish and results; 52 to 60 show analytics or a concise voiced summary if available. For a shortened demo, use an explicitly labeled demo preset with a shorter round; do not imply it is the default match length.

Submission evidence: live deployed URL, setup instructions, architecture description, two device video, dependency and asset credits, measured hardware limitations, and screenshots of results. Show keyboard mode only as a developer fallback and label recorded backup footage clearly.

## 18 Future direction and unresolved items

After the prototype, validate repeat play with five to ten users before adding a broader motion game platform. Potential roadmap: seated calibration, slips, richer attacks, configurable rounds, improved latency handling, licensed rigged avatars, consented ghost replays, and additional motion games using the input adapter.

Business hypothesis: a browser party game with optional cosmetic upgrades or hosted event rooms could be explored later. No payments, revenue assumptions, or commercial analytics belong in the hackathon scope. The first validation question is whether friends enjoy several matches and can set up without developer help.

Confirm before implementation: actual event and submission rules; sponsor track availability and judging criteria; both demo laptops and browsers; permitted prework; deployment budget and persistent server host; API access and quotas; whether TensorFlow is a hard requirement or MediaPipe satisfies the intended computer vision goal. Until changed, the defaults in this PRD govern implementation.

## 19 Technical references

The following official documentation was checked on October 3 2026. Product limits, thresholds, and schedules elsewhere in this PRD are proposed team decisions rather than claims made by these sources.

[1] Google MediaPipe Pose Landmarker for Web. Local pose outputs and synchronous inference behavior inform the worker design. https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js

[2] React Three Fiber introduction. https://r3f.docs.pmnd.rs/getting-started/introduction

[3] React Three Fiber performance pitfalls. https://r3f.docs.pmnd.rs/advanced/pitfalls

[4] Socket.IO delivery guarantees. https://socket.io/docs/v4/delivery-guarantees/

[5] Tiger Data hypertables. https://www.tigerdata.com/docs/learn/hypertables/understand-hypertables

[6] Gemini structured output. https://ai.google.dev/gemini-api/docs/structured-output

[7] ElevenLabs speech streaming. https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming
