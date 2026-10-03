# Pose verification

Run the focused tests with the existing TypeScript and Node toolchain:

```sh
node --test packages/motion/tests/pose.test.mjs apps/web/tests/inferenceClient.test.mjs
```

The tests cover anatomical identity and aspect correction, visibility filtering,
lost tracking, pause/recovery timing, one frame in flight, cancellation during
bitmap creation, capture errors, completion-rate diagnostics, and matching pinned
runtime/model assets. They use synthetic feature inputs and a fake worker; they
do not open a camera or retain user frames.

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
