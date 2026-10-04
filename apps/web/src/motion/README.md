# Local pose pipeline (A — Motion)

`usePoseLandmarker(videoRef, canvasRef, stream, showOverlay)` starts inference only
for an explicitly acquired camera stream. `pose.worker.ts` owns the MediaPipe
task: CPU delegate, VIDEO mode, one person, no segmentation. It loads the versioned
local lite model and ES module WASM runtime under `public/models`. Vite's base URL
is included in all asset paths, including deployments below a subpath.

`InferenceClient` captures at most 30 frames/s, downscales to at most 640 pixels
wide while preserving aspect ratio, and transfers an `ImageBitmap` to the worker.
Only one capture/inference is in flight; frames arriving while busy are dropped.
Duplicate video frames are skipped. Every bitmap is closed after processing or
cancellation. Loading and frame watchdogs surface stalled workers as retryable
errors. Stop, camera switch, hidden tab, or unmount disposes the task and worker.
Pose initialization/inference failure keeps camera playback usable.

Worker results contain camera-relative normalized image landmarks and timestamp,
image dimensions, filtered aspect-corrected landmarks, validity, missing required
points, and minimum required-landmark visibility. Anatomical labels are preserved.
Use aspect-corrected points before computing distances/angles; y increases down.
Optional hips are retained only when visible. Nose, shoulders, elbows, and wrists
must each meet 0.6 visibility and be inside the image for VALID. An absent pose is
LOST; a partial pose is LOW_CONFIDENCE. Credible model-estimated world joints are
retained locally for arm direction and elbow geometry; missing, nonfinite, or
implausible world segments use image geometry instead. Depth is an estimate, not
a measured physical distance or punching power.

The hook exposes smoothed `latestSample` and a bounded raw 300 ms history as refs so pose data
does not drive per-frame React renders. Only VALID samples enter history. History
is cleared after long gaps or teardown. DOM diagnostics update at most four times
per second, except tracking state transitions. The canvas overlay runs separately
on the display loop, aligns with object-fit contain, and mirrors display x only.
A safe pose may be held for at most 200 ms; it is never passed off as a new sample.

`TrackingMonitor` exposes `pauseRequired` and `canResume`. Invalid tracking for
500 ms latches a pause; a camera stop pauses immediately. Samples stopping for
200 ms become LOST. One second of continuous valid samples plus explicit
confirmation is required to clear the gate, including initial startup.
`useMotionControls` combines this with calibration: hold a visible neutral stance
for three uninterrupted seconds, then demonstrate left punch, right punch, guard,
and duck in order. Only **Confirm Ready** enables local practice controls. Camera
changes discard calibration; tracking loss cancels defense and gesture history,
requires a fresh bent-arm rearm, and requires confirmation after recovery.

`MotionController` owns the pure calibration/feature/detector pipeline in
`packages/motion`. Median calibration captures shoulder width, head/torso rest,
arm proportions, and jitter. Features compensate camera scale around the image
center and use shoulder-width units. Baseline position adapts slowly only during
quiet neutral stance after setup; actions never update it. Velocities use actual
sample timestamps. Adaptive pose smoothing damps rest jitter, follows fast arm
motion, filters depth more strongly, and resets across long gaps.

Punches require wrist motion and elbow extension within 250 ms. Depth can support
evidence but never trigger an attack alone. A shared 450 ms cooldown, per-hand
rest rearm, and deterministic strongest/left-tie selection prevent repeat events.
Guard enters after 100 ms and exits after 150 ms. Duck needs both head and shoulder
drop, enters after 100 ms, uses a smaller exit threshold, expires at 800 ms, and
requires 400 ms neutral to rearm. Attacks suppress both defenses during recovery.

Both `/game` and `/practice` expose guided setup, sensitivity, local feedback,
counts, and developer diagnostics. First-person arms consume smoothed estimated
directions and calibrated segment ratios. `latestControls` and `subscribeControls`
expose only normalized `MotionFrame` values; `PracticeAdapter` counts action edges.
The future SocketInputAdapter must forward pause requests and attach the shared
packet envelope. This change does not connect combat or multiplayer inputs; the
server remains responsible for match readiness, pause/resume, and accepted attacks.

Target: >=15 inference samples/s on both intended demo laptops, measured alongside
the arena. The panel shows actual completion rate and inference duration, not a
claim that the performance target has passed. Run the device checklist in
`../cam/README.md` before the hour-2 motion gate is considered complete.
