# Pose verification

Run the focused tests with the existing TypeScript and Node toolchain:

```sh
node --test packages/motion/tests/*.test.mjs apps/web/tests/inferenceClient.test.mjs
```

The tests cover anatomical identity and aspect correction, visibility filtering,
lost tracking, pause/recovery timing, one frame in flight, cancellation during
bitmap creation, capture errors, completion-rate diagnostics, and matching pinned
runtime/model assets. They use synthetic feature inputs and a fake worker; they
do not open a camera or retain user frames. Motion fixtures additionally cover
continuous calibration, all four checks, camera-distance normalization, timestamp
velocities, smoothing, world-depth fallback, punch cooldown/rearm/ties, defense
hysteresis, bounded duck/rearm, tracking gaps, and practice edge counts.

Browser checks performed on October 3, 2026 in a separate headless desktop Chrome
session, with the existing arena mounted:

- Local worker/model/WASM initialized and processed a synthetic canvas stream.
- The public Google pose fixture produced VALID with all nine named landmarks.
- Anatomical L/R labels and the overlay aligned with the mirrored, letterboxed
  video. See `pose-verification.png` (public fixture, not user video).
- Hiding landmarks left inference running without creating a new worker.
- Replacing the person with a blank canvas produced LOST, paused the gate, and
  cleared the visual overlay. Restoring the person required confirmation.
- Stop released synthetic tracks. Dispatching the hidden-tab visibility event
  also released every track and detached the video.
- Blocking the local model request displayed a retryable initialization error
  while camera video continued. Unblocking and retrying restored VALID tracking.
- No unhandled page exceptions were reported after successful recovery.

Headless spot checks showed approximately 13–16 Hz with the fixture/arena, with a
human-pose inference spot duration of 72.1 ms. These are not measurements on the
two intended demo laptops and do not establish the PRD's >=15 Hz or >=30 render
FPS targets. Actual webcam accuracy, permission recovery, device switching, and
performance still require the hardware checklist in `../src/cam/README.md`.

Guided motion setup browser verification (October 3, 2026):

- Used a local synthetic canvas stream and substituted sanitized landmark fixtures
  at the worker-result boundary. The real model/worker remained active, but these
  checks validate wiring and lifecycle rather than camera detection accuracy.
- The three-second neutral hold completed; Ready remained disabled before the
  left punch, right punch, guard, and duck checks all passed.
- Confirming Ready enabled local practice; one punch counted exactly once.
- Lost tracking cleared Ready and disabled confirmation. Recovery enabled
  confirmation after one second and did not automatically enable practice.
- Route exit released all synthetic tracks. First-person practice started with
  fresh calibration, loaded the fighter asset, and displayed the same setup with
  a scrolling panel. No captured page exceptions occurred.
- Inspected `motion-setup.png` and `motion-practice.png`. The camera picture is
  deliberately blank; the overlay uses synthetic landmarks. These images do not
  demonstrate webcam accuracy, arm retargeting accuracy, or hardware performance.

`packages/motion/tests/punches.test.mjs` reproduces missed partial extensions,
face-level guard rearm, depth-source dropout, and foreshortened straight punches.
The front-camera landmark trajectory passes through calibration and normalization
for both hands at 15 Hz. Negative cases reject depth spikes and retraction. These
are deterministic regression fixtures, not recordings of actual webcam trials.

The same front-camera image/world trajectory was replayed through the real local
worker-result boundary in a separate Chrome session. Both calibration punch
checks succeeded; after Ready, left and right each counted once even when held
extended for 1.2 seconds. No page exceptions occurred. The per-hand diagnostics
were visually inspected. This verifies the UI/control wiring, not live tracking
accuracy; actual teammate/device trials remain required.
