# Architecture

```text
Webcam → local pose worker → normalized controls ─┐
                                                  ├→ Socket.IO → API → authoritative match
React UI ← local feedback / server snapshots ─────┘                    ├→ results
Three.js scene ← local pose / accepted attacks                         └→ optional async services
```

The browser owns camera access, pose inference, calibration, presentation, and provisional local animation. Raw camera frames and audio stay on the device. The API binds each socket to one server-assigned seat and owns room state, accepted actions, combat timing, health, outcomes, and result counters. The shared core package owns packet schemas and gameplay constants. Motion detection is a pure client-side package and does not decide damage.

PostgreSQL/Tiger Data, Gemini, and ElevenLabs are optional P1 adapters. They consume completed events asynchronously and must never run inside or block the simulation tick. The P0 API uses one in-memory process; restarting it ends active rooms.
